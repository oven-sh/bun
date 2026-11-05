mod texts;

use std::sync::OnceLock;

use bun_ast::Loader;
use bun_core::fmt::hex_byte_lower;
use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, Decl, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    BinOp, CallId, ExportSpecId, ExprId, ExprKind, File, MemberKey, NodeData, PatId, PatKind,
    PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use bun_sema::import_sites::{
    ENCODERS, Encoder, ImportSiteKind, ImportSpecifier, ResolvedForm, is_exported,
};
use bun_sema::program::HostModuleId;
use bun_sema::resolve::{
    CodeResolution, ComputedCandidate, ComputedResolution, ExternalKind, FinishedFile,
    SiteResolution,
};
use bun_sema_driver::host::to_native;

use super::scan::ContentsScan;
use crate::builtins::table::{self, BuiltinFlags};
use crate::builtins::{BuiltinId, BuiltinName, Intrinsic, Resolved, RuntimeModule};
use crate::load::module_paths::with_separators_of_host;
use crate::module_keys::is_name_of_text;
use crate::options::PathOptions;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum WorkerNameForm {
    /// `new Worker("./w.ts")`: read as an entry point is written.
    AsWritten,
    /// `new URL(c, import.meta.url)`, `join(__dirname, c)`, `import.meta.dir + c`: `FileAnalysis::is_path_from_own_directory`.
    FromOwnFolder,
    /// `require.resolve(c)`, `import.meta.resolve(c)`: `FileAnalysis::find_resolved_form`.
    Resolved(ResolvedForm),
    /// `import path from "./w.ts" with { type: "file" }`: the import site.
    EmbeddedFile(u32),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct WorkerStart {
    /// The `new`.
    pub at: ExprId,
    pub name_node: ExprId,
    /// `Unknown` only where `is_argument_of_constructor`.
    pub name: ImportSpecifier,
    pub form: WorkerNameForm,
    /// The first one. Neither a `new URL` that stands alone nor a preload is.
    pub is_argument_of_constructor: bool,
}

struct WorkerBuiltins {
    /// The global `Worker`.
    constructor: Option<BuiltinId>,
    name_of_constructor: Option<BuiltinName>,
    /// The global `URL`.
    url_constructor: Option<BuiltinId>,
    /// `import.meta.url`
    own_url: Option<BuiltinId>,
    name_of_own_url: Option<BuiltinName>,
    /// node:worker_threads
    threads: Option<RuntimeModule>,
    /// `encodeURIComponent`, `btoa`
    encoders: [(Option<BuiltinId>, Encoder); 2],
    /// The global `Blob`.
    blob_constructor: Option<BuiltinId>,
    /// `URL.createObjectURL`
    object_url_maker: Option<BuiltinId>,
    /// `String.raw`
    raw_text_maker: Option<BuiltinId>,
    /// node:path
    paths: Option<RuntimeModule>,
    /// node:url
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

/// Whether what the site asks for is `module`, or may be where the name is computed.
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
        // With --no-builtin-modules no module of the library has an id.
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

fn begins_with_scheme(text: &[u8]) -> bool {
    let Some(end) = strings::index_of_char_usize(text, b':') else {
        return false;
    };
    let is_of_scheme =
        |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.');
    text[0].is_ascii_alphabetic() && text[..end].iter().all(is_of_scheme)
}

/// Whether a text that is read as a URL against the URL of a file names what the same text names as a path from the folder of that file.
/// The parser of URLs drops blanks at both ends and control characters, takes `\` for `/`, and whoever reads the path back decodes `%`.
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

/// `data:text/javascript,..`, `data:application/typescript;base64,..`: a whole `data:` URL whose type is that of a script. An image or a style sheet is no code that a Worker starts from.
/// `const start = "data:text/javascript,"` holds nothing: the program goes on to add the code.
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
                    self.found.worker_starts.push(WorkerStart {
                        at: expression,
                        name_node,
                        name: ImportSpecifier::Constant(name),
                        form: WorkerNameForm::FromOwnFolder,
                        is_argument_of_constructor: false,
                    });
                }
            }
            Some(Constructor::Url) | None => {}
        }
    }

    pub(super) fn look_at_name_of_worker_constructor(&mut self, expression: ExprId) {
        if self.request.bound.parent_of_expr(expression) == Parent::None {
            return;
        }
        self.found.names_worker_constructor = true;
        self.found.hands_worker_constructor_on |= !self.is_constructed_or_only_tested(expression);
    }

    /// The resolver of built-ins follows no module of the library that is written in JavaScript, so nobody else sees where `Worker` of node:worker_threads goes.
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
        let mut binds_worker_threads = false;
        let mut escapes = false;
        for (site, &resolution) in analysis.import_sites.iter().zip(resolutions) {
            if !may_load(resolution, threads) {
                continue;
            }
            let is_certain = matches!(resolution, SiteResolution::Constant(_));
            match site.kind {
                ImportSiteKind::Import(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::GetBuiltinModule(_)
                    if is_certain =>
                {
                    binds_worker_threads = true;
                }
                ImportSiteKind::ExportFrom(export) if is_certain => {
                    escapes |= hir[export].items.iter().any(|item| {
                        let item = &hir[item];
                        let leads_to_constructor =
                            item.local == known::default || self.is_name_of_worker(item.local);
                        !item.type_only && leads_to_constructor
                    });
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
                | ImportSiteKind::RequireByTestRunner(_) => escapes = true,
            }
        }
        if binds_worker_threads && !escapes {
            let exported = (0..hir.export_specs.len() as u32)
                .map(|specifier| bound.exported_binding(ExportSpecId(specifier)));
            let unspelled = analysis.bindings_read_without_expression(hir, bound);
            let mut direct_evals = bound.runtime.eval_scopes().iter();
            escapes = direct_evals.any(|&(call, _)| !analysis.decisions.is_dead_expr(call))
                || exported.chain(unspelled).any(|binding| {
                    matches!(binding, Binding::Symbol(symbol)
                        if self.holds_worker_threads(symbol) || self.holds_node_worker(symbol))
                });
        }
        if escapes {
            self.found.names_worker_constructor = true;
            self.found.hands_worker_constructor_on = true;
        }
        if !binds_worker_threads {
            return;
        }
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            if self.found.hands_worker_constructor_on {
                return;
            }
            let may_name_part = matches!(
                hir[expression].kind,
                ExprKind::Ident(_)
                    | ExprKind::Dot { .. }
                    | ExprKind::Index { .. }
                    | ExprKind::Call(_)
            );
            if !may_name_part
                || analysis.decisions.is_dead_expr(expression)
                || bound.parent_of_expr(expression) == Parent::None
            {
                continue;
            }
            if self.is_node_worker(expression) {
                self.look_at_name_of_worker_constructor(expression);
            } else if self.names_worker_threads(expression)
                && !self.reads_only_named_members(expression)
            {
                self.found.names_worker_constructor = true;
                self.found.hands_worker_constructor_on = true;
            }
        }
    }

    /// Also where the name is looked up at run time, under `with` or beside a direct eval: it may be the global.
    pub(super) fn find_builtin_that_may_be_named(&self, expression: ExprId) -> Option<BuiltinId> {
        match self.builtins.of_expr(expression) {
            Some(Resolved::Builtin(path) | Resolved::DynamicGlobal(path)) => Some(path.id),
            Some(Resolved::Intrinsic(Intrinsic::Builtin(id))) => Some(id),
            Some(Resolved::Intrinsic(_)) => None,
            None => self.find_member_of_dynamic_global(expression),
        }
    }

    /// `globalThis.Worker` where `globalThis` is looked up at run time: the resolver of built-ins reads no member off such a name.
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
        self.add_code_given_to_worker(argument, options, &name);
        if self.is_inline_worker_source(&name) {
            self.found.starts_worker_out_of_sight = true;
            return;
        }
        self.found.starts_worker_out_of_sight |= self.may_be_out_of_sight(&name);
        self.found.worker_starts.push(WorkerStart {
            at: construction,
            name_node: argument,
            name,
            form,
            is_argument_of_constructor: true,
        });
    }

    /// `{ preload: "./first.ts" }`, `{ preload: ["./first.ts", "./second.ts"] }`: the Worker loads those files in front of its own, and reads each text as it reads the one that it starts from.
    /// The literal may stand under a name, and so may a literal that it spreads and the list. A text too many adds a candidate entry point and never takes one away.
    fn add_preloads(&mut self, construction: ExprId, options: ExprId) {
        let &FinishedFile { hir, atoms, .. } = self.request;
        // `const options = { ...options }` leads back to itself.
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
                    is_argument_of_constructor: false,
                });
            }
        }
    }

    /// What a name is initialized with, or the expression itself. Without type assertions.
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

    /// sema keeps what it knows of `argument` under the argument as it is written, with its type assertions.
    fn find_name_given_to_worker(&self, argument: ExprId) -> (ImportSpecifier, WorkerNameForm) {
        let &FinishedFile { hir, analysis, .. } = self.request;
        // Folding may know the path of the copy in the executable, which says nothing of the file on disk.
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
        let form = match analysis.find_resolved_form(argument) {
            Some(form) => WorkerNameForm::Resolved(form),
            None if analysis.is_path_from_own_directory(argument) => WorkerNameForm::FromOwnFolder,
            None => WorkerNameForm::AsWritten,
        };
        (name, form)
    }

    /// `data:text/javascript,..` and `blob:..` hold or stand for the code itself. The load begins at what it knows whole (`FileContents::urls_with_code`, `texts_behind_object_urls`).
    /// Any other runs as the run time reads it.
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

    /// Nobody knows the name, or one of its values is the code itself. The engine takes a URL object for the name of some entry point, so nobody else says so.
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

    /// `import path from "./w.ts" with { type: "file" }`, where `argument` is `path`: the index of the import site. `import { default as path }` and
    /// `namespace.default` of `import * as namespace` are the same value, and so is a name that is initialized with one of the three and never stored to.
    /// Folding hands the path of a copy to no other file, so nobody else reads these.
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

    /// Of `new URL(c, import.meta.url)`: `c`, and what it names from the folder of the file, `./lib/w.ts`.
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

    /// `import.meta.url`, also under a name that the resolver of built-ins follows.
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
        // The resolver answers for a member only where the table lists it under its holder.
        let import_meta = Some(table::canonical_id(BuiltinId::ImportMeta));
        let member = hir.member_key(hir.skip_type_assertions(expression));
        matches!(member, Some((object, MemberKey::Name(name)))
            if find_builtin(object) == import_meta && self.is_named(name, known.name_of_own_url))
    }

    /// The start of the Worker says what the URL names.
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
            return hir.ids(hir[call].args).next() == Some(node)
                && self.find_constructor_called(call) == Some(Constructor::Worker);
        }
    }

    /// Nobody gets the constructor from `mention` but a `new` that `look_at_construction` reads.
    fn is_constructed_or_only_tested(&self, mention: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut node = mention;
        loop {
            let parent = match bound.parent_of_expr(node) {
                Parent::Expr(parent) => parent,
                Parent::Stmt(statement) => return is_condition_or_unused(hir, node, statement),
                // `const Worker = threads.Worker`: each mention of the name is looked at like this one.
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
                // `new (Worker || Other)(name)` is no start that anybody records.
                ExprKind::New(call) => {
                    return hir.skip_type_assertions(hir[call].callee) == mention;
                }
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                    ..
                } => return true,
                // The class on the right may have a `Symbol.hasInstance` of the program's, which is handed what stands on the left.
                ExprKind::Binary {
                    op: BinOp::Instanceof,
                    right,
                    ..
                } => return node == right,
                ExprKind::Binary {
                    op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                    ..
                } => return true,
                // `a && b` answers `a` only where `a` is no object.
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

    /// The site hands `module` itself to the code around it.
    fn loads_module(&self, site: Option<usize>, module: RuntimeModule) -> bool {
        let Some(site) = site else {
            return false;
        };
        let evaluates_to_module = matches!(
            self.request.analysis.import_sites[site].kind,
            ImportSiteKind::Import(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::GetBuiltinModule(_)
        );
        let resolution = self.request.resolutions[site];
        evaluates_to_module
            && matches!(resolution, SiteResolution::Constant(_))
            && may_load(resolution, module)
    }

    fn requires_module(&self, call: ExprId, module: RuntimeModule) -> bool {
        let &FinishedFile { hir, analysis, .. } = self.request;
        matches!(hir[call].kind, ExprKind::Call(_))
            && self.loads_module(analysis.import_site_of_call(call), module)
    }

    /// `import * as threads`, `import threads`, `const threads = require("node:worker_threads")`
    fn holds_module(&self, symbol: SymbolId, module: RuntimeModule) -> bool {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        let import = match *bound.symbol(symbol).decls {
            [Decl::ImportNamespace(import) | Decl::ImportDefault(import)] => Some(import),
            [Decl::ImportSpec(specifier)] if hir[specifier].imported == known::default => {
                Some(hir[specifier].import)
            }
            _ => None,
        };
        if let Some(import) = import {
            let site = analysis.import_site_index(ImportSiteKind::Import(import));
            return self.loads_module(site, module);
        }
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => {
                self.requires_module(hir.skip_type_assertions(source), module)
            }
            _ => false,
        }
    }

    fn names_module(&self, expression: ExprId, module: RuntimeModule) -> bool {
        match self.request.hir[expression].kind {
            ExprKind::Call(_) => self.requires_module(expression, module),
            ExprKind::Ident(_) => {
                let symbol = self.find_symbol_read(expression);
                symbol.is_some_and(|symbol| self.holds_module(symbol, module))
            }
            _ => false,
        }
    }

    /// Of `threads.Worker`: `Worker`.
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

    /// Of what `import { Worker }`, `const { Worker } = threads` and `const Worker = threads.Worker` bind: `Worker`.
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

    /// The name of the export of `module` that `expression` is.
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

    /// Of an expression that is the module: what is done with it hands on a member under a written name, or binds it so that `holds_worker_threads` and `holds_node_worker` know the names.
    fn reads_only_named_members(&self, mention: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut node = mention;
        loop {
            match bound.parent_of_expr(node) {
                Parent::Expr(parent) if hir.type_assertion_operand(parent).is_some() => {
                    node = parent;
                }
                // The namespace object has the module once more, under `default`.
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

    /// A plain name that holds what it is initialized with, and that only the expressions of this file read.
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
                matches!(hir[mention].kind, ExprKind::Call(_))
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

fn with_forward_slashes(mut path: Vec<u8>) -> Vec<u8> {
    for byte in &mut path {
        if *byte == b'\\' {
            *byte = b'/';
        }
    }
    path
}

// As `import.meta.url` and `pathToFileURL()` write it when the program runs: they escape what Node escapes, and the parser of URLs escapes the rest.
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

fn read_file_url(url: &[u8]) -> Option<Vec<u8>> {
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

// `path.resolve()` of node:path, for paths with forward slashes. `None`: the answer hangs on the working directory, or a part is written in another way.
fn resolve_paths(parts: &[Vec<u8>]) -> Option<Vec<u8>> {
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

/// A directory that the host has named, `C:\a\b` on Windows, as a program is taken to write it here.
fn with_separators_of_program(directory: &[u8]) -> Vec<u8> {
    match directory {
        [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic() => {
            with_forward_slashes(directory.to_vec())
        }
        _ => directory.to_vec(),
    }
}

/// The file on disk that an executable holds under `named`, a path below its `root`. A `..` that led out of the root directory is held as `_.._`.
fn find_path_on_disk(root_directory: &[u8], root: &[u8], named: &[u8]) -> Option<Vec<u8>> {
    let segments = strings::split(named.strip_prefix(root)?, b"/");
    let segments = segments.map(|it| if it == b"_.._" { &b".."[..] } else { it });
    let name = segments.collect::<Vec<_>>().join(&b"/"[..]);
    resolve_paths(&[with_separators_of_program(root_directory), name])
}

/// The file on disk that a program names by the path or the `file:` URL that it sees for the file when it runs in an executable, with forward slashes.
pub(crate) fn find_file_named_as_in_executable(
    paths: &PathOptions,
    name: &[u8],
) -> Option<Vec<u8>> {
    let root = with_forward_slashes(paths.module_prefix.clone());
    match name.starts_with(b"file:") {
        true => find_path_on_disk(&paths.root_directory, &root, &read_file_url(name)?),
        false => find_path_on_disk(&paths.root_directory, &root, name),
    }
}

/// `FoundEntryPoint::source_path` of a file that the load knows as `path`.
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
        find_file_named_as_in_executable(&paths_of_executable(), name)
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
