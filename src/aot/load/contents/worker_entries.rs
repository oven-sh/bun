mod texts;

use std::mem::take;
use std::sync::OnceLock;

use bun_ast::Loader;
use bun_core::fmt::hex_byte_lower;
use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, CommonJsVariable, Decl, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue, ends_in_name_with_extension};
use bun_sema::hir::{
    BinOp, CallId, ExportSpecId, ExprId, ExprKind, File, Flags, MemberKey, NodeData, PatId,
    PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use bun_sema::import_sites::{
    ENCODERS, Encoder, ImportSiteKind, ImportSpecifier, ResolvedForm, is_exported,
};
use bun_sema::program::HostModuleId;
use bun_sema::resolve::{
    CodeResolution, ComputedCandidate, ComputedResolution, ExternalKind, FinishedFile,
    SiteResolution,
};
use bun_sema::util::{FxHashSet, SharedSort};
use bun_sema_driver::host::to_native;

use super::NodeWorkerOutOfSight;
use super::entry_points::is_relative_path;
use super::load_names::{is_made_of_texts, is_part_of_longer_text, is_written_as_value};
use super::scan::ContentsScan;
use crate::builtins::table::{self, BuiltinFlags, Origin};
use crate::builtins::{BuiltinId, BuiltinName, Intrinsic, Resolved, RuntimeModule};
use crate::load::is_in_node_modules;
use crate::load::module_paths::{read_path_above_root, with_separators_of_host};
use crate::module_keys::is_name_of_text;
use crate::options::PathOptions;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum WorkerNameForm {
    AsWritten,
    FromOwnFolder,
    OwnFile,
    Resolved(ResolvedForm),
    EmbeddedFile(u32),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct WorkerStart {
    pub at: ExprId,
    pub name_node: ExprId,
    pub name: ImportSpecifier,
    pub form: WorkerNameForm,
    pub place: PlaceOfName,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum PlaceOfName {
    Constructor,
    Preload,
    Elsewhere,
}

struct WorkerBuiltins {
    constructor: Option<BuiltinId>,
    name_of_constructor: Option<BuiltinName>,
    url_constructor: Option<BuiltinId>,
    own_url: Option<BuiltinId>,
    name_of_own_url: Option<BuiltinName>,
    threads: Option<RuntimeModule>,
    encoders: [(Option<BuiltinId>, Encoder); 2],
    blob_constructor: Option<BuiltinId>,
    object_url_maker: Option<BuiltinId>,
    raw_text_maker: Option<BuiltinId>,
    paths: Option<RuntimeModule>,
    urls: Option<RuntimeModule>,
}

fn worker_builtins() -> &'static WorkerBuiltins {
    static FOUND: OnceLock<WorkerBuiltins> = OnceLock::new();
    FOUND.get_or_init(|| {
        let name_of_constructor = table::find_name(b"Worker");
        let name_of_own_url = table::find_name(b"url");
        let global = |name: Option<BuiltinName>| name.and_then(table::global);
        let own_url =
            name_of_own_url.and_then(|name| table::own_member(BuiltinId::ImportMeta, name));
        let find_global = |name: &[u8]| global(table::find_name(name)).map(table::canonical_id);
        let url_constructor = find_global(b"URL");
        let object_url_maker = url_constructor
            .zip(table::find_name(b"createObjectURL"))
            .and_then(|(holder, name)| table::own_member(holder, name));
        let raw_text_maker = find_global(b"String")
            .zip(table::find_name(b"raw"))
            .and_then(|(holder, name)| table::own_member(holder, name));
        WorkerBuiltins {
            constructor: global(name_of_constructor).map(table::canonical_id),
            name_of_constructor,
            url_constructor,
            own_url: own_url.map(table::canonical_id),
            name_of_own_url,
            threads: table::module_by_specifier(b"node:worker_threads"),
            encoders: ENCODERS.map(|(name, encode)| (find_global(name), encode)),
            blob_constructor: find_global(b"Blob"),
            object_url_maker: object_url_maker.map(table::canonical_id),
            raw_text_maker: raw_text_maker.map(table::canonical_id),
            paths: table::module_by_specifier(b"node:path"),
            urls: table::module_by_specifier(b"node:url"),
        }
    })
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Constructor {
    Worker,
    Url,
}

type FileGiven = (ExprId, Option<(ImportSpecifier, WorkerNameForm)>);

fn is_each_a_file(given: &[FileGiven]) -> bool {
    !given.is_empty() && given.iter().all(|value| value.1.is_some())
}

fn may_load(resolution: SiteResolution<'_>, module: RuntimeModule) -> bool {
    let is_module = |id: Option<HostModuleId>| {
        id.and_then(|id| RuntimeModule::from_registry_id(id.0)) == Some(module)
    };
    let is_candidate = |candidate: &ComputedCandidate<'_>| match *candidate {
        ComputedCandidate::File(file) => is_module(file.host_module),
        ComputedCandidate::HostModule(id) => is_module(Some(id)),
    };
    match resolution {
        SiteResolution::Constant(CodeResolution::File(file)) => is_module(file.host_module),
        SiteResolution::Constant(CodeResolution::HostModule(id)) => is_module(Some(id)),
        SiteResolution::Constant(CodeResolution::External {
            specifier,
            kind: ExternalKind::HostValue,
        }) => {
            let listed = table::specifier_of(module);
            specifier == listed || listed.strip_prefix(b"node:") == Some(specifier)
        }
        SiteResolution::Constant(
            CodeResolution::External { .. } | CodeResolution::Erased | CodeResolution::NotFound(_),
        ) => false,
        SiteResolution::Computed(ComputedResolution::Candidates { candidates, .. }) => {
            candidates.iter().any(is_candidate)
        }
        SiteResolution::Computed(ComputedResolution::All { host_modules, .. }) => {
            host_modules.iter().any(is_candidate)
        }
    }
}

fn is_condition_or_unused(hir: &File<'_>, node: ExprId, statement: StmtId) -> bool {
    match hir[statement].kind {
        StmtKind::Expr(_) => true,
        StmtKind::If { test, .. }
        | StmtKind::While { test, .. }
        | StmtKind::DoWhile { test, .. } => node == test,
        StmtKind::For { test, update, .. } => node == test || node == update,
        _ => false,
    }
}

fn loads_runtime_module(resolution: SiteResolution<'_>) -> bool {
    match resolution {
        SiteResolution::Constant(CodeResolution::File(file)) => file.host_module.is_some(),
        SiteResolution::Constant(resolution) => matches!(
            resolution,
            CodeResolution::HostModule(_)
                | CodeResolution::External {
                    kind: ExternalKind::HostValue,
                    ..
                }
        ),
        SiteResolution::Computed(_) => false,
    }
}

fn makes_another_value(kind: ExprKind) -> bool {
    matches!(
        kind,
        ExprKind::Binary { op: BinOp::Add, .. }
            | ExprKind::Template { .. }
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
    )
}

fn begins_with_scheme(text: &[u8]) -> bool {
    let Some(end) = strings::index_of_char_usize(text, b':') else {
        return false;
    };
    let is_of_scheme =
        |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.');
    text[0].is_ascii_alphabetic() && text[..end].iter().all(is_of_scheme)
}

fn is_plain_relative_path(text: &[u8]) -> bool {
    let (Some(&first), Some(&last)) = (text.first(), text.last()) else {
        return false;
    };
    first != b'/'
        && first != b' '
        && last != b' '
        && strings::index_of_any(text, b"%?#\\").is_none()
        && !text.iter().any(u8::is_ascii_control)
        && !begins_with_scheme(text)
}

pub(super) fn is_url_with_code(text: &[u8]) -> bool {
    let Some(written) = text.strip_prefix(b"data:") else {
        return false;
    };
    let Some(comma) = strings::index_of_char_usize(written, b',') else {
        return false;
    };
    if comma + 1 == written.len() {
        return false;
    }
    let parameters = strings::index_of_char_usize(&written[..comma], b';');
    let media_type = written[..parameters.unwrap_or(comma)].to_ascii_lowercase();
    strings::contains(&media_type, b"script")
        || media_type.ends_with(b"jsx")
        || media_type.ends_with(b"tsx")
}

impl ContentsScan<'_, '_> {
    pub(super) fn look_at_construction(&mut self, expression: ExprId) {
        let &FinishedFile { hir, bound, .. } = self.request;
        let ExprKind::New(call) = hir[expression].kind else {
            return;
        };
        if bound.parent_of_expr(expression) == Parent::None {
            return;
        }
        match self.find_constructor_called(call) {
            Some(Constructor::Worker) => self.add_start_of_worker(expression, call),
            Some(Constructor::Url) if !self.is_worker_argument(expression) => {
                if let Some((name_node, name)) = self.find_file_named_by_own_url(call) {
                    let name = ImportSpecifier::Constant(name);
                    let form = WorkerNameForm::FromOwnFolder;
                    self.add_name_written_elsewhere(expression, name_node, name, form);
                }
            }
            Some(Constructor::Url) | None => {}
        }
    }

    fn add_name_written_elsewhere(
        &mut self,
        at: ExprId,
        name_node: ExprId,
        name: ImportSpecifier,
        form: WorkerNameForm,
    ) {
        let request = self.request;
        if is_in_node_modules(request.path)
            || request.analysis.decisions.is_dead_expr(at)
            || !is_written_as_value(request, at)
            || self.is_worker_argument(at)
            || self.find_value_handed_on(at).is_none()
        {
            return;
        }
        self.found.worker_starts.push(WorkerStart {
            at,
            name_node,
            name,
            form,
            place: PlaceOfName::Elsewhere,
        });
    }

    pub(super) fn look_at_paths_written_from_own_folder(&mut self) {
        let request = self.request;
        let decisions = &request.analysis.decisions;
        for &(path, name) in decisions.paths_written_from_own_directory() {
            if !is_part_of_longer_text(request, path) {
                let name = ImportSpecifier::Constant(name);
                self.add_name_written_elsewhere(path, path, name, WorkerNameForm::FromOwnFolder);
            }
        }
    }

    pub(super) fn look_at_name_asked_of_resolver(&mut self, index: usize) {
        let &FinishedFile {
            hir,
            analysis,
            atoms,
            ..
        } = self.request;
        let site = &analysis.import_sites[index];
        let (call, form) = match site.kind {
            ImportSiteKind::RequireResolve(call) => (call, ResolvedForm::Path),
            ImportSiteKind::ImportMetaResolve(call) => (call, ResolvedForm::Url),
            _ => return,
        };
        let (ExprKind::Call(written), ImportSpecifier::Constant(name)) =
            (hir[call].kind, site.specifier)
        else {
            return;
        };
        if hir[written].args.len() == 1 && is_relative_path(atoms.bytes(name)) {
            let form = WorkerNameForm::Resolved(form);
            self.add_name_written_elsewhere(call, site.specifier_node, site.specifier, form);
        }
    }

    pub(super) fn look_at_relative_path(&mut self, expression: ExprId, text: Atom) {
        let request = self.request;
        let bytes = request.atoms.bytes(text);
        if is_relative_path(bytes)
            && ends_in_name_with_extension(bytes)
            && is_made_of_texts(request, expression)
            && !is_part_of_longer_text(request, expression)
        {
            let (name, form) = (ImportSpecifier::Constant(text), WorkerNameForm::AsWritten);
            self.add_name_written_elsewhere(expression, expression, name, form);
        }
    }

    pub(super) fn look_at_names_of_own_file(&mut self) {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        if !bound.may_name_own_path() {
            return;
        }
        for (mention, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
            if !analysis.decisions.is_dead_expr(mention) {
                self.look_at_name_of_own_file(mention, node.kind);
            }
        }
        self.look_at_holders_of_own_file();
    }

    fn look_at_name_of_own_file(&mut self, mention: ExprId, kind: ExprKind) {
        let bound = self.request.bound;
        let filename = CommonJsVariable::Filename;
        match kind {
            ExprKind::Ident(known::filename)
                if bound.binding(mention) == Binding::CommonJs(filename)
                    && self.find_source_path(mention, filename).is_some() =>
            {
                self.look_at_own_file_held(mention, true);
            }
            ExprKind::ImportMeta => self.look_at_import_meta(mention),
            _ => {}
        }
    }

    fn look_at_import_meta(&mut self, written: ExprId) {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut meta = written;
        while let Parent::Expr(above) = bound.parent_of_expr(meta) {
            if hir.type_assertion_operand(above).is_none() {
                break;
            }
            meta = above;
        }
        let member = match bound.parent_of_expr(meta) {
            Parent::Expr(above) => hir
                .member_key(above)
                .map(|(object, key)| (above, object, key)),
            _ => None,
        };
        match member {
            Some((
                read,
                object,
                MemberKey::Name(known::url | known::meta_filename | known::path)
                | MemberKey::Computed(_),
            )) if object == meta => self.look_at_own_file_held(read, true),
            Some((_, object, _)) if object == meta => {}
            _ => self.look_at_own_file_held(meta, false),
        }
    }

    fn look_at_own_file_held(&mut self, held: ExprId, follows_holder: bool) {
        let &FinishedFile { hir, bound, .. } = self.request;
        let Some(value) = self.find_value_handed_on(held) else {
            return;
        };
        let holder = match bound.parent_of_expr(value) {
            Parent::VarInit(declaration) if follows_holder => Some(hir[declaration].pat),
            Parent::Expr(above) if makes_another_value(hir[above].kind) => return,
            _ => None,
        };
        let holder = holder.filter(|&name| self.is_stable_unexported_name(name));
        match holder.map(|name| bound.initialized_binding(name)) {
            Some(Binding::Symbol(symbol)) => self.holders_of_own_file.push(symbol),
            _ => {
                let (name, form) = (ImportSpecifier::Unknown, WorkerNameForm::OwnFile);
                self.add_name_written_elsewhere(value, held, name, form);
            }
        }
    }

    fn look_at_holders_of_own_file(&mut self) {
        let mut holders = take(&mut self.holders_of_own_file);
        if holders.is_empty() {
            return;
        }
        holders.shared_sort_unstable();
        let hir = self.request.hir;
        for read in (0..hir.exprs.len() as u32).map(ExprId) {
            let symbol = match hir[read].kind {
                ExprKind::Ident(_) => self.find_symbol_read(read),
                _ => None,
            };
            if symbol.is_some_and(|symbol| holders.binary_search(&symbol).is_ok()) {
                self.look_at_own_file_held(read, false);
            }
        }
    }

    fn find_value_handed_on(&self, written: ExprId) -> Option<ExprId> {
        let mut value = written;
        while let Some((made, call)) = self.find_call_given(value) {
            if self.spells_same_file(call) {
                value = self.find_text_of_url(made).unwrap_or(made);
            } else if self.calls_builtin(call) {
                return None;
            } else {
                break;
            }
        }
        Some(value)
    }

    fn find_text_of_url(&self, url: ExprId) -> Option<ExprId> {
        let &FinishedFile {
            hir, bound, atoms, ..
        } = self.request;
        let Parent::Expr(above) = bound.parent_of_expr(url) else {
            return None;
        };
        match hir.member_key(above) {
            Some((object, MemberKey::Name(name))) if object == url => {
                matches!(atoms.bytes(name), b"href" | b"pathname").then_some(above)
            }
            _ => None,
        }
    }

    fn find_call_given(&self, value: ExprId) -> Option<(ExprId, CallId)> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut node = value;
        loop {
            let Parent::Expr(parent) = bound.parent_of_expr(node) else {
                return None;
            };
            if hir.type_assertion_operand(parent).is_some() {
                node = parent;
                continue;
            }
            let (ExprKind::Call(call) | ExprKind::New(call)) = hir[parent].kind else {
                return None;
            };
            let is_argument = hir.ids(hir[call].args).any(|argument| argument == node);
            return is_argument.then_some((parent, call));
        }
    }

    fn calls_builtin(&self, call: CallId) -> bool {
        let hir = self.request.hir;
        let callee = hir.skip_type_assertions(hir[call].callee);
        let builtin = self.find_builtin_that_may_be_named(callee);
        builtin.is_some_and(|builtin| table::entry(builtin).origin == Origin::Host)
            || self.is_export_of_runtime_module(callee)
    }

    fn is_export_of_runtime_module(&self, callee: ExprId) -> bool {
        let hir = self.request.hir;
        let holder = match hir.member_key(callee) {
            Some((object, _)) => hir.skip_type_assertions(object),
            None => callee,
        };
        let load = match hir[holder].kind {
            ExprKind::Ident(_) => {
                let symbol = self.find_symbol_read(holder);
                symbol.and_then(|symbol| self.find_load_that_fills(symbol))
            }
            _ => self.find_load_at(holder),
        };
        load.is_some_and(|load| loads_runtime_module(self.request.resolutions[load]))
    }

    fn find_load_that_fills(&self, symbol: SymbolId) -> Option<usize> {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        let import = match *bound.symbol(symbol).decls {
            [Decl::ImportNamespace(import) | Decl::ImportDefault(import)] => Some(import),
            [Decl::ImportSpec(specifier)] => Some(hir[specifier].import),
            _ => None,
        };
        if let Some(import) = import {
            return analysis.import_site_index(ImportSiteKind::Import(import));
        }
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source)
            | BindingInitializer::PatternProperty { source, .. } => {
                self.find_load_at(hir.skip_type_assertions(source))
            }
            _ => None,
        }
    }

    fn find_load_at(&self, call: ExprId) -> Option<usize> {
        let &FinishedFile { hir, analysis, .. } = self.request;
        match hir[call].kind {
            ExprKind::Call(_) => analysis.import_site_of_call(call),
            _ => None,
        }
    }

    fn spells_same_file(&self, call: CallId) -> bool {
        let hir = self.request.hir;
        let callee = hir.skip_type_assertions(hir[call].callee);
        let urls = worker_builtins().urls;
        let export = urls.and_then(|urls| self.find_export_named(callee, urls));
        hir[call].args.len() == 1
            && (matches!(export, Some(known::fileURLToPath | known::pathToFileURL))
                || self.find_constructor_called(call) == Some(Constructor::Url))
    }

    pub(super) fn look_at_name_of_worker_constructor(&mut self, expression: ExprId) {
        if self.request.bound.parent_of_expr(expression) == Parent::None {
            return;
        }
        self.found.names_worker_constructor = true;
        self.found.hands_worker_constructor_on |= !self.is_constructed_or_only_tested(expression);
    }

    fn find_node_of_site(&self, kind: ImportSiteKind) -> NodeData {
        let hir = self.request.hir;
        match kind {
            ImportSiteKind::Import(import) => NodeData::Stmt(hir[import].stmt),
            ImportSiteKind::ExportFrom(export) => NodeData::Stmt(hir[export].stmt),
            ImportSiteKind::ExportStar(statement) => NodeData::Stmt(statement),
            ImportSiteKind::ImportEquals(import) => NodeData::Stmt(hir[import].stmt),
            _ => kind.call().map_or(NodeData::None, NodeData::Expr),
        }
    }

    fn follows_load(&self, kind: ImportSiteKind, module: RuntimeModule) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        // bun_sema names no file through a path or URL module that is loaded in these two ways.
        let is_of_threads = || Some(module) == worker_builtins().threads;
        match kind {
            ImportSiteKind::Import(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_)
            | ImportSiteKind::GetBuiltinModule(_) => true,
            ImportSiteKind::ImportEquals(import) => {
                let alias = bound.declared_symbol(Decl::ImportEquals(import));
                is_of_threads()
                    && matches!(bound.symbol(alias).decls, [Decl::ImportEquals(_)])
                    && !hir[import].flags.contains(Flags::EXPORT)
            }
            ImportSiteKind::ImportCall(call) => {
                is_of_threads() && self.is_awaited_at_once_or_unused(call)
            }
            _ => false,
        }
    }

    fn is_awaited_at_once_or_unused(&self, promise: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut node = promise;
        loop {
            match bound.parent_of_expr(node) {
                Parent::Expr(parent) if hir.type_assertion_operand(parent).is_some() => {
                    node = parent;
                }
                Parent::Expr(parent) => return matches!(hir[parent].kind, ExprKind::Await(_)),
                Parent::Stmt(statement) => return matches!(hir[statement].kind, StmtKind::Expr(_)),
                _ => return false,
            }
        }
    }

    fn note_node_worker_handed_on(&mut self, at: NodeData) {
        self.found.names_worker_constructor = true;
        self.found.hands_worker_constructor_on = true;
        self.found
            .node_workers_out_of_sight
            .push(NodeWorkerOutOfSight {
                at,
                is_told_to_evaluate: false,
            });
    }

    pub(super) fn look_at_loads_of_worker_threads(&mut self) {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            resolutions,
            ..
        } = self.request;
        let Some(threads) = worker_builtins().threads else {
            return;
        };
        let mut bound_at = None;
        let mut escapes_at = None;
        let mut is_loaded_by_uncertain_name = false;
        for (site, &resolution) in analysis.import_sites.iter().zip(resolutions) {
            if !may_load(resolution, threads) {
                continue;
            }
            let is_certain = matches!(resolution, SiteResolution::Constant(_));
            match site.kind {
                ImportSiteKind::Import(_)
                | ImportSiteKind::ImportEquals(_)
                | ImportSiteKind::ImportCall(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::GetBuiltinModule(_)
                    if is_certain && self.follows_load(site.kind, threads) =>
                {
                    bound_at.get_or_insert_with(|| self.find_node_of_site(site.kind));
                }
                ImportSiteKind::ExportFrom(export) if is_certain => {
                    let escapes = hir[export].items.iter().any(|item| {
                        let item = &hir[item];
                        let leads_to_constructor =
                            item.local == known::default || self.is_name_of_worker(item.local);
                        !item.type_only && leads_to_constructor
                    });
                    if escapes {
                        escapes_at.get_or_insert_with(|| self.find_node_of_site(site.kind));
                    }
                }
                ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::MockModule(_)
                | ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage => {}
                ImportSiteKind::Import(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::GetBuiltinModule(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::ImportEquals(_)
                | ImportSiteKind::ImportCall(_)
                | ImportSiteKind::ImportByTestRunner(_)
                | ImportSiteKind::RequireByTestRunner(_)
                    if is_certain =>
                {
                    escapes_at.get_or_insert_with(|| self.find_node_of_site(site.kind));
                }
                _ => is_loaded_by_uncertain_name = true,
            }
        }
        if let (Some(bound_at), None) = (bound_at, escapes_at) {
            let exported = (0..hir.export_specs.len() as u32)
                .map(|specifier| bound.exported_binding(ExportSpecId(specifier)));
            let unspelled = analysis.bindings_read_without_expression(hir, bound);
            let mut direct_evals = bound.runtime.eval_scopes().iter();
            let escapes = direct_evals.any(|&(call, _)| !analysis.decisions.is_dead_expr(call))
                || exported.chain(unspelled).any(|binding| {
                    matches!(binding, Binding::Symbol(symbol)
                        if self.holds_worker_threads(symbol) || self.holds_node_worker(symbol))
                });
            escapes_at = escapes.then_some(bound_at);
        }
        if is_loaded_by_uncertain_name {
            self.found.names_worker_constructor = true;
            self.found.hands_worker_constructor_on = true;
        }
        if let Some(at) = escapes_at {
            return self.note_node_worker_handed_on(at);
        }
        if bound_at.is_none() {
            return;
        }
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let may_name_part = matches!(
                hir[expression].kind,
                ExprKind::Ident(_)
                    | ExprKind::Dot { .. }
                    | ExprKind::Index { .. }
                    | ExprKind::Call(_)
                    | ExprKind::Await(_)
            );
            if !may_name_part
                || analysis.decisions.is_dead_expr(expression)
                || bound.parent_of_expr(expression) == Parent::None
            {
                continue;
            }
            let is_handed_on = match self.is_node_worker(expression) {
                true => {
                    self.found.names_worker_constructor = true;
                    !self.is_constructed_or_only_tested(expression)
                }
                false => {
                    self.names_worker_threads(expression)
                        && !self.reads_only_named_members(expression)
                }
            };
            if is_handed_on {
                return self.note_node_worker_handed_on(NodeData::Expr(expression));
            }
        }
    }

    pub(super) fn find_builtin_that_may_be_named(&self, expression: ExprId) -> Option<BuiltinId> {
        match self.builtins.of_expr(expression) {
            Some(Resolved::Builtin(path) | Resolved::DynamicGlobal(path)) => Some(path.id),
            Some(Resolved::Intrinsic(Intrinsic::Builtin(id))) => Some(id),
            Some(Resolved::Intrinsic(_)) => None,
            None => self.find_member_of_dynamic_global(expression),
        }
    }

    fn find_member_of_dynamic_global(&self, member: ExprId) -> Option<BuiltinId> {
        let &FinishedFile { hir, atoms, .. } = self.request;
        let (object, MemberKey::Name(name)) = hir.member_key(member)? else {
            return None;
        };
        let object = hir.skip_type_assertions(object);
        let Resolved::DynamicGlobal(holder) = self.builtins.of_expr(object)? else {
            return None;
        };
        if !table::has_flag(holder.id, BuiltinFlags::IS_GLOBAL_OBJECT) {
            return None;
        }
        table::global(table::find_name(atoms.bytes(name))?)
    }

    pub(super) fn look_at_constructions_behind_module_handed_on(&mut self) {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        if !self.found.hands_worker_constructor_on {
            return;
        }
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::New(call) = hir[expression].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[call].callee);
            let Some((_, MemberKey::Name(member))) = hir.member_key(callee) else {
                continue;
            };
            if self.is_name_of_worker(member)
                && !analysis.decisions.is_dead_expr(expression)
                && bound.parent_of_expr(expression) != Parent::None
                && self.find_constructor_called(call).is_none()
            {
                self.add_start_of_worker(expression, call);
            }
        }
    }

    fn find_constructor_called(&self, call: CallId) -> Option<Constructor> {
        let hir = self.request.hir;
        let known = worker_builtins();
        let callee = hir.skip_type_assertions(hir[call].callee);
        let builtin = self.find_builtin_that_may_be_named(callee);
        match builtin.map(table::canonical_id) {
            Some(id) if Some(id) == known.constructor => Some(Constructor::Worker),
            Some(id) if Some(id) == known.url_constructor => Some(Constructor::Url),
            Some(_) | None => self.is_node_worker(callee).then_some(Constructor::Worker),
        }
    }

    fn add_start_of_worker(&mut self, construction: ExprId, call: CallId) {
        let hir = self.request.hir;
        self.found.names_worker_constructor = true;
        let mut arguments = hir.ids(hir[call].args);
        let Some(argument) = arguments.next() else {
            return;
        };
        let options = arguments.next();
        if let Some(options) = options {
            self.add_preloads(construction, options);
        }
        let (name, form) = self.find_name_given_to_worker(argument);
        let is_text_put_together = self.add_code_given_to_worker(argument, options, &name);
        if name == ImportSpecifier::Unknown
            && is_text_put_together
            && self.add_files_given(construction, argument, options)
        {
            return;
        }
        let callee = hir.skip_type_assertions(hir[call].callee);
        let builtin = self.find_builtin_that_may_be_named(callee);
        let is_of_web = builtin.is_some_and(|builtin| {
            Some(table::canonical_id(builtin)) == worker_builtins().constructor
        });
        let is_told_to_evaluate = options.is_some_and(|it| self.is_told_to_evaluate(it));
        let is_name_in_sight = form == WorkerNameForm::OwnFile || !self.may_be_out_of_sight(&name);
        let may_be_out_of_sight = is_told_to_evaluate || !is_name_in_sight;
        if !is_of_web && may_be_out_of_sight && !is_text_put_together {
            self.found
                .node_workers_out_of_sight
                .push(NodeWorkerOutOfSight {
                    at: NodeData::Expr(construction),
                    is_told_to_evaluate,
                });
        }
        if self.is_inline_worker_source(&name) {
            self.found.starts_worker_out_of_sight = true;
            return;
        }
        self.found.starts_worker_out_of_sight |= !is_name_in_sight;
        self.found.worker_starts.push(WorkerStart {
            at: construction,
            name_node: argument,
            name,
            form,
            place: PlaceOfName::Constructor,
        });
    }

    fn add_files_given(
        &mut self,
        construction: ExprId,
        argument: ExprId,
        options: Option<ExprId>,
    ) -> bool {
        if options.is_some_and(|options| self.is_told_to_evaluate(options)) {
            return false;
        }
        let given = self.find_files_given(argument);
        let named = given.iter().filter_map(|&(name_node, file)| {
            let (name, form) = file?;
            Some(WorkerStart {
                at: construction,
                name_node,
                name,
                form,
                place: PlaceOfName::Constructor,
            })
        });
        self.found.worker_starts.extend(named);
        is_each_a_file(&given)
    }

    fn find_files_given(&self, argument: ExprId) -> Vec<FileGiven> {
        let mut given = Vec::new();
        let mut looked_at = FxHashSet::default();
        let as_given = self.find_values_given(argument).into_iter();
        let mut pending: Vec<(ExprId, bool)> = as_given.map(|value| (value, false)).collect();
        while let Some((value, is_converted)) = pending.pop() {
            if !looked_at.insert((value, is_converted)) {
                continue;
            }
            match self.find_what_names_same_file(value) {
                Some(inner) => {
                    let converted = self.find_values_given(inner).into_iter();
                    pending.extend(converted.map(|value| (value, true)));
                }
                None => given.push((value, self.find_file_written(value, is_converted))),
            }
        }
        given
    }

    fn find_what_names_same_file(&self, value: ExprId) -> Option<ExprId> {
        let hir = self.request.hir;
        match hir[value].kind {
            ExprKind::Call(call) | ExprKind::New(call) if self.spells_same_file(call) => {
                hir.ids(hir[call].args).next()
            }
            ExprKind::Call(call) if hir[call].args.is_empty() => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                self.find_url_read_as(callee, &[b"toString", b"toJSON"])
            }
            ExprKind::Dot { .. } => self.find_url_read_as(value, &[b"href", b"pathname"]),
            _ => None,
        }
    }

    fn find_url_read_as(&self, member: ExprId, names: &[&[u8]]) -> Option<ExprId> {
        let &FinishedFile { hir, atoms, .. } = self.request;
        match hir.member_key(member) {
            Some((url, MemberKey::Name(name))) if names.contains(&atoms.bytes(name)) => Some(url),
            _ => None,
        }
    }

    fn gives_files_alone(&self, argument: ExprId) -> bool {
        is_each_a_file(&self.find_files_given(argument))
    }

    fn find_file_written(
        &self,
        written: ExprId,
        is_converted: bool,
    ) -> Option<(ImportSpecifier, WorkerNameForm)> {
        let decisions = &self.request.analysis.decisions;
        if self.names_own_file(written) {
            return Some((ImportSpecifier::Unknown, WorkerNameForm::OwnFile));
        }
        if let Some(name) = decisions.find_path_written_from_own_directory(written) {
            return Some((
                ImportSpecifier::Constant(name),
                WorkerNameForm::FromOwnFolder,
            ));
        }
        if let Some(answer) = self.find_file_asked_of_resolver(written) {
            return Some(answer);
        }
        let (name, form) = self.find_name_given_to_worker(written);
        // pathToFileURL("./w.js") reads the text from the working directory of the run, not as a Worker reads it.
        let is_read_otherwise =
            is_converted && form == WorkerNameForm::AsWritten && !self.is_anchored(&name);
        (!self.may_be_out_of_sight(&name) && !is_read_otherwise).then_some((name, form))
    }

    fn is_anchored(&self, name: &ImportSpecifier) -> bool {
        let &FinishedFile {
            analysis, atoms, ..
        } = self.request;
        let mut alternatives = analysis.alternatives_of(name).iter();
        alternatives.all(|alternative| match *alternative {
            ImportSpecifier::Constant(start) | ImportSpecifier::Pattern { prefix: start, .. } => {
                let text = atoms.bytes(start);
                is_absolute(text) || begins_with_scheme(text)
            }
            ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => false,
        })
    }

    fn find_file_asked_of_resolver(
        &self,
        call: ExprId,
    ) -> Option<(ImportSpecifier, WorkerNameForm)> {
        let &FinishedFile {
            hir,
            analysis,
            atoms,
            ..
        } = self.request;
        let ExprKind::Call(written) = hir[call].kind else {
            return None;
        };
        let site = &analysis.import_sites[analysis.import_site_of_call(call)?];
        let form = match site.kind {
            ImportSiteKind::RequireResolve(_) => ResolvedForm::Path,
            ImportSiteKind::ImportMetaResolve(_) => ResolvedForm::Url,
            _ => return None,
        };
        let is_beside = matches!(site.specifier, ImportSpecifier::Constant(name)
            if is_relative_path(atoms.bytes(name)));
        (hir[written].args.len() == 1 && is_beside)
            .then_some((site.specifier, WorkerNameForm::Resolved(form)))
    }

    fn names_own_file(&self, written: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let filename = CommonJsVariable::Filename;
        match hir[written].kind {
            ExprKind::Ident(known::filename) => {
                bound.binding(written) == Binding::CommonJs(filename)
                    && self.find_source_path(written, filename).is_some()
            }
            ExprKind::Dot { .. } => match hir.member_key(written) {
                Some((meta, MemberKey::Name(known::url | known::meta_filename | known::path))) => {
                    matches!(
                        hir[hir.skip_type_assertions(meta)].kind,
                        ExprKind::ImportMeta
                    ) && !bound.import_meta_may_be_modified()
                }
                _ => false,
            },
            _ => false,
        }
    }

    fn add_preloads(&mut self, construction: ExprId, options: ExprId) {
        let &FinishedFile { hir, atoms, .. } = self.request;
        let mut literals = vec![self.find_value_under_name(options)];
        let mut looked_at = 0;
        while let Some(&literal) = literals.get(looked_at) {
            looked_at += 1;
            let ExprKind::Object(properties) = hir[literal].kind else {
                continue;
            };
            for property in properties.iter().map(|property| hir[property]) {
                match (property.kind, property.key) {
                    (PropKind::Spread, _) => {
                        let spread = self.find_value_under_name(property.value);
                        if !literals.contains(&spread) {
                            literals.push(spread);
                        }
                    }
                    (PropKind::Init | PropKind::Shorthand, PropKey::Name(name))
                        if atoms.bytes(name) == b"preload" =>
                    {
                        self.add_files_preloaded(construction, property.value);
                    }
                    _ => {}
                }
            }
        }
    }

    fn add_files_preloaded(&mut self, construction: ExprId, preload: ExprId) {
        let hir = self.request.hir;
        let preload = self.find_value_under_name(preload);
        let names: Vec<ExprId> = match hir[preload].kind {
            ExprKind::Array(names) => hir.ids(names).collect(),
            _ => vec![preload],
        };
        for name_node in names {
            if let Some(text) = self.find_constant_text(name_node) {
                self.found.worker_starts.push(WorkerStart {
                    at: construction,
                    name_node,
                    name: ImportSpecifier::Constant(text),
                    form: WorkerNameForm::AsWritten,
                    place: PlaceOfName::Preload,
                });
            }
        }
    }

    fn find_value_under_name(&self, expression: ExprId) -> ExprId {
        let &FinishedFile { hir, bound, .. } = self.request;
        let expression = hir.skip_type_assertions(expression);
        let symbol = match hir[expression].kind {
            ExprKind::Ident(_) => self.find_symbol_read(expression),
            _ => None,
        };
        match symbol.map(|symbol| bound.binding_initializer(hir, symbol)) {
            Some(BindingInitializer::Expression(value)) => hir.skip_type_assertions(value),
            Some(_) | None => expression,
        }
    }

    fn find_name_given_to_worker(&self, argument: ExprId) -> (ImportSpecifier, WorkerNameForm) {
        let &FinishedFile { hir, analysis, .. } = self.request;
        if let Some(site) = self.find_import_of_embedded_file(argument) {
            let name = analysis.import_sites[site].specifier;
            return (name, WorkerNameForm::EmbeddedFile(site as u32));
        }
        let name = match analysis.find_name_of_worker(argument) {
            Some(&name) => name,
            None => match self.find_constant_text(argument) {
                Some(text) => ImportSpecifier::Constant(text),
                None => analysis.decisions.specifier(argument),
            },
        };
        if name == ImportSpecifier::Unknown
            && let ExprKind::New(call) = hir[hir.skip_type_assertions(argument)].kind
            && self.find_constructor_called(call) == Some(Constructor::Url)
            && let Some((_, name)) = self.find_file_named_by_own_url(call)
        {
            let name = ImportSpecifier::Constant(name);
            return (name, WorkerNameForm::FromOwnFolder);
        }
        if name == ImportSpecifier::Unknown && self.spells_own_file(argument) {
            return (name, WorkerNameForm::OwnFile);
        }
        let form = match analysis.find_resolved_form(argument) {
            Some(form) => WorkerNameForm::Resolved(form),
            None if analysis.is_path_from_own_directory(argument) => WorkerNameForm::FromOwnFolder,
            None => WorkerNameForm::AsWritten,
        };
        (name, form)
    }

    fn spells_own_file(&self, written: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        if bound.import_meta_may_be_modified() {
            return false;
        }
        let follow = |written: ExprId| {
            let written = hir.skip_type_assertions(written);
            let is_stored_again = matches!(hir[written].kind, ExprKind::Ident(_))
                && (self.find_symbol_read(written))
                    .is_some_and(|symbol| !bound.is_stable_binding(symbol));
            match is_stored_again {
                true => written,
                false => self.find_value_under_name(written),
            }
        };
        let mut passed = Vec::new();
        let mut value = follow(written);
        while let ExprKind::Call(call) | ExprKind::New(call) = hir[value].kind
            && self.spells_same_file(call)
            && let Some(given) = hir.ids(hir[call].args).next()
            && !passed.contains(&value)
        {
            passed.push(value);
            value = follow(given);
        }
        self.names_own_url(value)
    }

    fn is_inline_worker_source(&self, name: &ImportSpecifier) -> bool {
        let &FinishedFile {
            analysis, atoms, ..
        } = self.request;
        let mut alternatives = analysis.alternatives_of(name).iter();
        alternatives.all(|alternative| match *alternative {
            ImportSpecifier::Constant(start) | ImportSpecifier::Pattern { prefix: start, .. } => {
                is_name_of_text(atoms.bytes(start))
            }
            ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => false,
        })
    }

    fn may_be_out_of_sight(&self, name: &ImportSpecifier) -> bool {
        let mut alternatives = self.request.analysis.alternatives_of(name).iter();
        alternatives.any(|alternative| {
            *alternative == ImportSpecifier::Unknown || self.is_inline_worker_source(alternative)
        })
    }

    fn find_constant_text(&self, expression: ExprId) -> Option<Atom> {
        let &FinishedFile { hir, analysis, .. } = self.request;
        let expression = hir.skip_type_assertions(expression);
        match analysis.decisions.constant(hir, expression) {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => Some(text),
            FoldedValue::Constant(_)
            | FoldedValue::ConstantOutsideDeadZone(_)
            | FoldedValue::Unknown => None,
        }
    }

    fn find_import_of_embedded_file(&self, argument: ExprId) -> Option<usize> {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            atoms,
            ..
        } = self.request;
        let is_looked_up_at_run_time =
            |name: ExprId| bound.dynamic_lookup_scope(NodeData::Expr(name)).is_some();
        let argument = hir.skip_type_assertions(argument);
        let value = self.find_value_under_name(argument);
        if value != argument {
            let holder = self.find_symbol_read(argument)?;
            if !bound.is_stable_binding(holder) || is_looked_up_at_run_time(argument) {
                return None;
            }
        }
        let (name, is_member) = match hir.member_key(value) {
            Some((namespace, MemberKey::Name(member))) if member == known::default => {
                (hir.skip_type_assertions(namespace), true)
            }
            Some(_) => return None,
            None => (value, false),
        };
        let symbol = match hir[name].kind {
            ExprKind::Ident(_) => self.find_symbol_read(name)?,
            _ => return None,
        };
        let import = match (bound.symbol(symbol).decls, is_member) {
            (&[Decl::ImportDefault(import)], false) | (&[Decl::ImportNamespace(import)], true) => {
                import
            }
            (&[Decl::ImportSpec(specifier)], false)
                if hir[specifier].imported == known::default =>
            {
                hir[specifier].import
            }
            _ => return None,
        };
        if is_looked_up_at_run_time(name) {
            return None;
        }
        let written = hir.import_attribute(hir[import].attributes, known::r#type)?;
        if Loader::from_string(atoms.bytes(written)) != Some(Loader::File) {
            return None;
        }
        analysis.import_site_index(ImportSiteKind::Import(import))
    }

    fn find_file_named_by_own_url(&self, call: CallId) -> Option<(ExprId, Atom)> {
        let &FinishedFile {
            hir, bound, atoms, ..
        } = self.request;
        let mut arguments = hir.ids(hir[call].args);
        let (written, base) = (arguments.next()?, arguments.next()?);
        if !self.names_own_url(base) || bound.import_meta_may_be_modified() {
            return None;
        }
        let text = self.find_constant_text(written)?;
        let bytes = atoms.bytes(text);
        if !is_plain_relative_path(bytes) {
            return None;
        }
        let name = match bytes.starts_with(b"./") {
            true => text,
            false => atoms.intern(&[&b"./"[..], bytes].concat()),
        };
        Some((written, name))
    }

    fn names_own_url(&self, expression: ExprId) -> bool {
        let hir = self.request.hir;
        let known = worker_builtins();
        let find_builtin = |expression: ExprId| {
            let expression = hir.skip_type_assertions(expression);
            let builtin = self.builtins.builtin_of_expression(expression);
            builtin.map(table::canonical_id)
        };
        if let Some(builtin) = find_builtin(expression) {
            return Some(builtin) == known.own_url;
        }
        let import_meta = Some(table::canonical_id(BuiltinId::ImportMeta));
        let member = hir.member_key(hir.skip_type_assertions(expression));
        matches!(member, Some((object, MemberKey::Name(name)))
            if find_builtin(object) == import_meta && self.is_named(name, known.name_of_own_url))
    }

    fn is_worker_argument(&self, url: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut node = url;
        loop {
            let Parent::Expr(parent) = bound.parent_of_expr(node) else {
                return false;
            };
            if hir.type_assertion_operand(parent).is_some() {
                node = parent;
                continue;
            }
            let ExprKind::New(call) = hir[parent].kind else {
                return false;
            };
            // An argument that gives the start no name stays a name that is written elsewhere.
            return hir.ids(hir[call].args).next() == Some(node)
                && self.find_constructor_called(call) == Some(Constructor::Worker)
                && self.gives_start_a_name(node);
        }
    }

    fn gives_start_a_name(&self, argument: ExprId) -> bool {
        let name = self.find_name_given_to_worker(argument).0;
        !self.may_be_out_of_sight(&name) || self.gives_files_alone(argument)
    }

    fn is_constructed_or_only_tested(&self, mention: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut node = mention;
        loop {
            let parent = match bound.parent_of_expr(node) {
                Parent::Expr(parent) => parent,
                Parent::Stmt(statement) => return is_condition_or_unused(hir, node, statement),
                Parent::VarInit(declaration) => {
                    let name = hir[declaration].pat;
                    return self.is_stable_unexported_name(name)
                        && matches!(bound.initialized_binding(name), Binding::Symbol(symbol)
                            if self.holds_node_worker(symbol));
                }
                _ => return false,
            };
            match hir[parent].kind {
                _ if hir.type_assertion_operand(parent).is_some() => {}
                ExprKind::New(call) => {
                    return hir.skip_type_assertions(hir[call].callee) == mention;
                }
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                    ..
                } => return true,
                ExprKind::Binary {
                    op: BinOp::Instanceof,
                    right,
                    ..
                } => return node == right,
                ExprKind::Binary {
                    op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                    ..
                } => return true,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    left,
                    ..
                } if node == left => return true,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    ..
                } => {}
                ExprKind::Cond { test, .. } if node == test => return true,
                ExprKind::Cond { .. } => {}
                _ => return false,
            }
            node = parent;
        }
    }

    fn is_named(&self, name: Atom, listed: Option<BuiltinName>) -> bool {
        listed.is_some_and(|listed| self.request.atoms.bytes(name) == table::text_of_name(listed))
    }

    fn is_name_of_worker(&self, name: Atom) -> bool {
        self.is_named(name, worker_builtins().name_of_constructor)
    }

    fn find_symbol_read(&self, name: ExprId) -> Option<SymbolId> {
        let bound = self.request.bound;
        match bound.binding(name) {
            Binding::Symbol(symbol) if bound.is_evaluated_ident(name) => Some(symbol),
            _ => None,
        }
    }

    fn loads_module(&self, site: Option<usize>, module: RuntimeModule) -> bool {
        let Some(site) = site else {
            return false;
        };
        let kind = self.request.analysis.import_sites[site].kind;
        let resolution = self.request.resolutions[site];
        matches!(resolution, SiteResolution::Constant(_))
            && may_load(resolution, module)
            && self.follows_load(kind, module)
    }

    fn evaluates_to_module(&self, load: ExprId, module: RuntimeModule) -> bool {
        let &FinishedFile { hir, analysis, .. } = self.request;
        let site = match hir[load].kind {
            ExprKind::Call(_) => analysis.import_site_of_call(load),
            ExprKind::Await(promise) => {
                let call = hir.skip_type_assertions(promise);
                analysis.import_site_index(ImportSiteKind::ImportCall(call))
            }
            _ => None,
        };
        self.loads_module(site, module)
    }

    fn holds_module(&self, symbol: SymbolId, module: RuntimeModule) -> bool {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        let load = match *bound.symbol(symbol).decls {
            [Decl::ImportNamespace(import) | Decl::ImportDefault(import)] => {
                Some(ImportSiteKind::Import(import))
            }
            [Decl::ImportSpec(specifier)] if hir[specifier].imported == known::default => {
                Some(ImportSiteKind::Import(hir[specifier].import))
            }
            [Decl::ImportEquals(import)] => Some(ImportSiteKind::ImportEquals(import)),
            _ => None,
        };
        if let Some(load) = load {
            return self.loads_module(analysis.import_site_index(load), module);
        }
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => {
                self.evaluates_to_module(hir.skip_type_assertions(source), module)
            }
            _ => false,
        }
    }

    fn names_module(&self, expression: ExprId, module: RuntimeModule) -> bool {
        match self.request.hir[expression].kind {
            ExprKind::Call(_) | ExprKind::Await(_) => self.evaluates_to_module(expression, module),
            ExprKind::Ident(_) => {
                let symbol = self.find_symbol_read(expression);
                symbol.is_some_and(|symbol| self.holds_module(symbol, module))
            }
            _ => false,
        }
    }

    fn find_export_read_off_module(&self, member: ExprId, module: RuntimeModule) -> Option<Atom> {
        let hir = self.request.hir;
        match hir.member_key(member) {
            Some((object, MemberKey::Name(name)))
                if self.names_module(hir.skip_type_assertions(object), module) =>
            {
                Some(name)
            }
            _ => None,
        }
    }

    fn find_export_held(&self, symbol: SymbolId, module: RuntimeModule) -> Option<Atom> {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        if let &[Decl::ImportSpec(specifier)] = bound.symbol(symbol).decls {
            let specifier = &hir[specifier];
            let site = analysis.import_site_index(ImportSiteKind::Import(specifier.import));
            return self
                .loads_module(site, module)
                .then_some(specifier.imported);
        }
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::PatternProperty { source, path } => match path[..] {
                [name] if self.names_module(hir.skip_type_assertions(source), module) => Some(name),
                _ => None,
            },
            BindingInitializer::Expression(source) => {
                self.find_export_read_off_module(hir.skip_type_assertions(source), module)
            }
            _ => None,
        }
    }

    fn find_export_named(&self, expression: ExprId, module: RuntimeModule) -> Option<Atom> {
        match self.request.hir[expression].kind {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.find_export_read_off_module(expression, module)
            }
            ExprKind::Ident(_) => self.find_export_held(self.find_symbol_read(expression)?, module),
            _ => None,
        }
    }

    fn holds_worker_threads(&self, symbol: SymbolId) -> bool {
        let threads = worker_builtins().threads;
        threads.is_some_and(|threads| self.holds_module(symbol, threads))
    }

    fn holds_node_worker(&self, symbol: SymbolId) -> bool {
        let threads = worker_builtins().threads;
        let export = threads.and_then(|threads| self.find_export_held(symbol, threads));
        export.is_some_and(|export| self.is_name_of_worker(export))
    }

    fn names_worker_threads(&self, expression: ExprId) -> bool {
        let threads = worker_builtins().threads;
        threads.is_some_and(|threads| self.names_module(expression, threads))
    }

    fn is_node_worker(&self, expression: ExprId) -> bool {
        let threads = worker_builtins().threads;
        let export = threads.and_then(|threads| self.find_export_named(expression, threads));
        export.is_some_and(|export| self.is_name_of_worker(export))
    }

    fn reads_only_named_members(&self, mention: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut node = mention;
        loop {
            match bound.parent_of_expr(node) {
                Parent::Expr(parent) if hir.type_assertion_operand(parent).is_some() => {
                    node = parent;
                }
                Parent::Expr(parent) => {
                    return matches!(hir.member_key(parent), Some((object, MemberKey::Name(name)))
                        if object == node && name != known::default);
                }
                Parent::VarInit(declaration) => {
                    return self.binds_only_named_members(hir[declaration].pat, mention);
                }
                Parent::Stmt(statement) => return matches!(hir[statement].kind, StmtKind::Expr(_)),
                _ => return false,
            }
        }
    }

    fn is_stable_unexported_name(&self, name: PatId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        match bound.initialized_binding(name) {
            Binding::Symbol(symbol) => {
                matches!(hir[name].kind, PatKind::Ident(_))
                    && bound.is_stable_binding(symbol)
                    && !is_exported(hir, bound, symbol)
            }
            _ => false,
        }
    }

    fn binds_only_named_members(&self, pattern: PatId, mention: ExprId) -> bool {
        let hir = self.request.hir;
        match hir[pattern].kind {
            PatKind::Ident(_) => {
                matches!(hir[mention].kind, ExprKind::Call(_) | ExprKind::Await(_))
                    && self.is_stable_unexported_name(pattern)
            }
            PatKind::Object(properties) => properties.iter().all(|property| {
                let PropKey::Name(name) = hir.runtime_binding_key(property) else {
                    return false;
                };
                let property = &hir[property];
                let constructor_escapes = self.is_name_of_worker(name)
                    && (property.default.is_some()
                        || !self.is_stable_unexported_name(property.value));
                !property.is_rest && name != known::default && !constructor_escapes
            }),
            PatKind::Array(_) | PatKind::Missing => false,
        }
    }
}

fn is_absolute(path: &[u8]) -> bool {
    path.starts_with(b"/") || matches!(path, [drive, b':', b'/', ..] if drive.is_ascii_alphabetic())
}

pub(crate) fn with_forward_slashes(mut path: Vec<u8>) -> Vec<u8> {
    for byte in &mut path {
        if *byte == b'\\' {
            *byte = b'/';
        }
    }
    path
}

pub(crate) fn write_file_url(path: &[u8]) -> Option<Vec<u8>> {
    if !is_absolute(path) {
        return None;
    }
    let mut url = b"file://".to_vec();
    if !path.starts_with(b"/") {
        url.push(b'/');
    }
    for &byte in path {
        let is_written_as_it_is = byte.is_ascii_graphic()
            && !matches!(
                byte,
                b'"' | b'#'
                    | b'%'
                    | b'<'
                    | b'>'
                    | b'?'
                    | b'`'
                    | b'{'
                    | b'}'
                    | b'\\'
                    | b'['
                    | b']'
                    | b'^'
                    | b'|'
                    | b'~'
            );
        if is_written_as_it_is {
            url.push(byte);
        } else {
            url.push(b'%');
            url.extend(hex_byte_lower(byte).map(|digit| digit.to_ascii_uppercase()));
        }
    }
    Some(url)
}

pub(crate) fn write_url_of_module(public_path: &[u8]) -> Option<Vec<u8>> {
    write_file_url(&with_forward_slashes(public_path.to_vec()))
}

pub(crate) fn write_url_of_path(path: &[u8]) -> Option<Vec<u8>> {
    write_file_url(&with_separators_of_program(path))
}

pub(crate) fn join_to_url_of_module(public_path: &[u8], name: &[u8]) -> Option<Vec<u8>> {
    let url = write_url_of_module(public_path)?;
    let written = strings::split(&url[b"file://".len()..], b"/");
    let mut kept: Vec<&[u8]> = written.filter(|segment| !segment.is_empty()).collect();
    let is_drive = |segment: &[u8]| matches!(segment, [drive, b':'] if drive.is_ascii_alphabetic());
    let floor = usize::from(kept.first().is_some_and(|&first| is_drive(first)));
    kept.pop();
    for segment in strings::split(name, b"/") {
        match segment {
            b"" | b"." => {}
            b".." if kept.len() > floor => {
                kept.pop();
            }
            b".." => {}
            _ => kept.push(segment),
        }
    }
    Some([&b"file:///"[..], &kept.join(&b"/"[..])].concat())
}

pub(crate) fn read_file_url(url: &[u8]) -> Option<Vec<u8>> {
    let written = url.strip_prefix(b"file://")?;
    if !written.starts_with(b"/") || strings::index_of_any(written, b"?#").is_some() {
        return None;
    }
    let mut path = Vec::with_capacity(written.len());
    let mut rest = written;
    while let [byte, following @ ..] = rest {
        rest = following;
        if *byte != b'%' {
            path.push(*byte);
            continue;
        }
        let [high, low, following @ ..] = rest else {
            return None;
        };
        let digit = |digit: u8| (digit as char).to_digit(16);
        path.push((digit(*high)? * 16 + digit(*low)?) as u8);
        rest = following;
    }
    match is_absolute(&path[1..]) {
        true => Some(path.split_off(1)),
        false => Some(path),
    }
}

pub(crate) fn resolve_paths(parts: &[Vec<u8>]) -> Option<Vec<u8>> {
    let first = parts.iter().rposition(|part| is_absolute(part))?;
    let root_length = match parts[first].starts_with(b"/") {
        true => 1,
        false => 3,
    };
    let mut segments: Vec<&[u8]> = Vec::new();
    for (index, part) in parts[first..].iter().enumerate() {
        if strings::contains_char(part, b'\\') || strings::contains_char(part, 0) {
            return None;
        }
        let part = &part[if index == 0 { root_length } else { 0 }..];
        for segment in strings::split(part, b"/") {
            match segment {
                b"" | b"." => {}
                b".." => {
                    segments.pop();
                }
                _ => segments.push(segment),
            }
        }
    }
    let mut resolved = parts[first][..root_length].to_vec();
    resolved.extend_from_slice(&segments.join(&b"/"[..]));
    Some(resolved)
}

fn with_separators_of_program(directory: &[u8]) -> Vec<u8> {
    match directory {
        [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic() => {
            with_forward_slashes(directory.to_vec())
        }
        _ => directory.to_vec(),
    }
}

fn find_way_from_root_directory(
    root: &[u8],
    levels_above_root: usize,
    named: &[u8],
) -> Option<Vec<u8>> {
    match named.strip_prefix(root) {
        Some(below_root) => {
            let segments = strings::split(below_root, b"/");
            let segments = segments.map(|it| if it == b"_.._" { &b".."[..] } else { it });
            Some(segments.collect::<Vec<_>>().join(&b"/"[..]))
        }
        None => {
            let (level, below) = read_path_above_root(root, levels_above_root, named)?;
            Some([&b"../".repeat(level)[..], below].concat())
        }
    }
}

pub(crate) fn find_way_named_as_in_executable(
    paths: &PathOptions,
    levels_above_root: usize,
    name: &[u8],
) -> Option<Vec<u8>> {
    let root = with_forward_slashes(paths.module_prefix.clone());
    let find = |name: &[u8]| find_way_from_root_directory(&root, levels_above_root, name);
    match name.starts_with(b"file:") {
        true => find(&read_file_url(name)?),
        false => find(name),
    }
}

pub(crate) fn count_highest_level_on_way(way: &[u8]) -> usize {
    let (mut level, mut highest) = (0isize, 0isize);
    for segment in strings::split(way, b"/") {
        match segment {
            b"" | b"." => {}
            b".." => level += 1,
            _ => level -= 1,
        }
        highest = highest.max(level);
    }
    highest as usize
}

pub(crate) fn find_file_on_way(paths: &PathOptions, way: Vec<u8>) -> Option<Vec<u8>> {
    resolve_paths(&[with_separators_of_program(&paths.root_directory), way])
}

pub(crate) fn find_file_named_as_in_executable(
    paths: &PathOptions,
    levels_above_root: usize,
    name: &[u8],
) -> Option<Vec<u8>> {
    find_file_on_way(
        paths,
        find_way_named_as_in_executable(paths, levels_above_root, name)?,
    )
}

pub(crate) fn source_path_of(path: &[u8]) -> Vec<u8> {
    with_separators_of_host(to_native(path), cfg!(windows))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths_of_executable() -> PathOptions {
        PathOptions {
            module_prefix: b"/$bunfs/root/".to_vec(),
            root_directory: b"/project".to_vec(),
            entry_point_names: Vec::new(),
            entry_point_file_names: Vec::new(),
        }
    }

    fn find(name: &[u8]) -> Option<Vec<u8>> {
        find_file_named_as_in_executable(&paths_of_executable(), 2, name)
    }

    #[test]
    fn file_url_escapes_what_the_run_time_escapes() {
        let url = write_file_url(b"/a b/c#[1]~.ts");
        assert_eq!(
            url.as_deref(),
            Some(&b"file:///a%20b/c%23%5B1%5D%7E.ts"[..])
        );
        let url = write_file_url(b"C:/a/b.ts");
        assert_eq!(url.as_deref(), Some(&b"file:///C:/a/b.ts"[..]));
        assert_eq!(write_file_url(b"a/b.ts"), None);
        let url = write_url_of_path(br"C:\a\b.ts");
        assert_eq!(url.as_deref(), Some(&b"file:///C:/a/b.ts"[..]));
        let url = write_url_of_path(br"/a\b.ts");
        assert_eq!(url.as_deref(), Some(&b"file:///a%5Cb.ts"[..]));
        assert_eq!(write_file_url(br"C:\a\b.ts"), None);
    }

    #[test]
    fn url_takes_a_folder_away_where_the_path_of_a_module_spells_a_parent() {
        let says = |path: &[u8], name: &[u8]| join_to_url_of_module(path, name).unwrap();
        let main = b"/$bunfs/root/main.js";
        assert_eq!(says(main, b"./lib/a.js"), b"file:///$bunfs/root/lib/a.js");
        assert_eq!(says(main, b"../job.js"), b"file:///$bunfs/job.js");
        assert_eq!(says(main, b"../../job.js"), b"file:///job.js");
        assert_eq!(says(main, b"../../../job.js"), b"file:///job.js");
        let below = b"/$bunfs/root/lib/a.js";
        assert_eq!(says(below, b"../../job"), b"file:///$bunfs/job");
        let above = b"/$bunfs/_.._/_.._/jobs/a.js";
        assert_eq!(says(above, b"../../x.js"), b"file:///$bunfs/_.._/x.js");
        let on_windows = b"B:\\~BUN\\root\\main.js";
        assert_eq!(says(on_windows, b"../../../job.js"), b"file:///B:/job.js");
    }

    #[test]
    fn file_url_is_read_back_as_the_path() {
        for path in [&b"/a b/c#%.ts"[..], b"C:/a/b.ts"] {
            let url = write_file_url(path).unwrap();
            assert_eq!(read_file_url(&url).as_deref(), Some(path));
        }
        assert_eq!(read_file_url(b"file:///a.ts?x"), None);
        assert_eq!(read_file_url(b"file:///a%2"), None);
    }

    #[test]
    fn path_below_the_root_of_the_executable_names_the_file_below_the_root_directory() {
        let found = find(b"/$bunfs/root/lib/w.js");
        assert_eq!(found.as_deref(), Some(&b"/project/lib/w.js"[..]));
        let found = find(b"file:///$bunfs/root/lib/w.js");
        assert_eq!(found.as_deref(), Some(&b"/project/lib/w.js"[..]));
        let found = find(b"/$bunfs/root/_.._/other/w.js");
        assert_eq!(found.as_deref(), Some(&b"/other/w.js"[..]));
        let found = find(b"/$bunfs/_.._/_.._/other/w.js");
        assert_eq!(found.as_deref(), Some(&b"/other/w.js"[..]));
        let found = find(b"file:///$bunfs/_.._/_.._/_.._/lib/w.js");
        assert_eq!(found.as_deref(), Some(&b"/project/lib/w.js"[..]));
        assert_eq!(find(b"/$bunfs/other/w.js"), None);
        let paths = paths_of_executable();
        let written = b"/$bunfs/_.._/_.._/other/w.js";
        assert_eq!(find_file_named_as_in_executable(&paths, 0, written), None);
        assert_eq!(find(b"/project/lib/w.js"), None);
        assert_eq!(find(b"./lib/w.js"), None);
    }

    #[test]
    fn url_with_code_names_a_script_and_holds_something() {
        let accepted: [&[u8]; 3] = [
            b"data:text/javascript,1",
            b"data:Application/TypeScript;base64,MQ==",
            b"data:text/jsx;charset=utf-8,1",
        ];
        for text in accepted {
            assert!(is_url_with_code(text), "{text:?}");
        }
        let refused: [&[u8]; 7] = [
            b"data:text/javascript,",
            b"data:text/javascript",
            b"data:,1",
            b"data:image/png;base64,AAAA",
            b"data:text/css,script",
            b"blob:script,1",
            b"./script.js",
        ];
        for text in refused {
            assert!(!is_url_with_code(text), "{text:?}");
        }
    }

    #[test]
    fn text_that_a_url_would_read_otherwise_names_no_file() {
        for text in [&b"./w.ts"[..], b"w.ts", b"../lib/my worker.ts", b"./a:b.ts"] {
            assert!(is_plain_relative_path(text), "{text:?}");
        }
        let refused: [&[u8]; 12] = [
            b"",
            b"/w.ts",
            b" ./w.ts",
            b"./w.ts ",
            b"./w\n.ts",
            b".\\w.ts",
            b"./w%20.ts",
            b"./w.ts?a",
            b"./w.ts#a",
            b"file:///w.ts",
            b"data:text/javascript,1",
            b"C:/w.ts",
        ];
        for text in refused {
            assert!(!is_plain_relative_path(text), "{text:?}");
        }
    }
}
