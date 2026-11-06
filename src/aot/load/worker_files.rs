use bun_ast::Loader;
use bun_core::fmt::hex_byte_lower;
use bun_core::strings::{self, is_valid_utf8};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, CommonJsVariable, Decl, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    BinOp, Branches, CallId, ExportSpecId, ExprId, ExprKind, PatId, PatKind, PropKey, PropKind,
    StmtKind,
};
use bun_sema::import_sites::{
    ENCODERS, Encoder, ImportSiteKind, find_values_of_parameter, is_exported,
};
use bun_sema::messages::Category;
use bun_sema::program::{CodeAnswer, FileId, Files};
use bun_sema_driver::Locator;
use bun_sema_driver::host::to_native;

use crate::builtins::{BuiltinId, Intrinsic, Resolved, RuntimeModule, table};
use crate::compile::{CodeOfWorkers, EntryPointPaths};
use crate::diagnostics::{ShownPosition, new_driver_diagnostic, position_of_diagnostic};
use crate::ir::parallel::{InParallel, map_each};
use crate::load::loaders::{loader_named_by_path, script_kind_of};
use crate::load::module_paths::{
    compute_module_path, compute_relative_path, with_separators_of_host,
};
use crate::load::named_loads::find_import_of;
use crate::load::source_provider::SourceProvider;
use crate::load::sources::parsed_source;
use crate::load::{SourceKind, is_host_path, is_in_node_modules};
use crate::module_keys::{is_name_of_text, is_url_with_text, name_of_text};
use crate::options::{EntryText, PathOptions};
use crate::statistics::{LimitId, LimitValues};

/// Code that the program starts a Worker with: a file that it embeds with the `file` loader, a file that it names by a path, or a text that it holds.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct WorkerFile {
    /// Of a text: `embedded_path`.
    pub source_path: Vec<u8>,
    /// What the import answers: the path of the copy in the executable. Of a file that is named by a path: the path of its module there.
    /// Of a text: what the run time knows it by, the `data:` URL that holds it or its `name_of_text`.
    pub embedded_path: Vec<u8>,
    /// The compiler lost track of the path and some Worker gets an unknown value, or another native function looks at the path too.
    pub is_guess: bool,
    /// The Worker may also get an options object.
    pub has_options: bool,
    /// Of a file that the engine reported: one `new Worker()` that may get the path.
    pub started_at: Option<ShownPosition>,
    /// What a text says, decoded, and the number of the loader that reads it.
    pub text: Option<(Vec<u8>, u8)>,
    /// The program writes the path out, and nothing else says that the file is part of it.
    pub is_named_by_path: bool,
}

impl WorkerFile {
    pub(crate) fn entry_text(&self) -> Option<EntryText> {
        let (contents, loader) = self.text.clone()?;
        let is_loader = |it: &&Loader| **it as u8 == loader;
        Some(EntryText {
            name: self.embedded_path.clone(),
            contents,
            loader: *LOADERS_OF_CODE.iter().find(is_loader)?,
        })
    }
}

const LOADERS_OF_CODE: [Loader; 4] = [Loader::Js, Loader::Jsx, Loader::Ts, Loader::Tsx];

pub(crate) struct WorkerSearch<'a> {
    pub limits: &'a LimitValues,
    pub loaders: &'a [(Vec<u8>, Loader)],
    pub paths: &'a PathOptions,
    pub runs_in_place: bool,
    pub provider: &'a dyn SourceProvider,
    /// The file that the build takes for an entry point which is written so, in the format of the checker.
    pub resolve_entry_point: &'a dyn Fn(&[u8]) -> Option<Vec<u8>>,
    /// The file that a name without `./` in front leads to from the root directory: that of a package, else one in the directory.
    pub resolve_bare_name: &'a dyn Fn(&[u8]) -> Option<Vec<u8>>,
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

fn write_file_url(path: &[u8]) -> Option<Vec<u8>> {
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
                b'"' | b'#' | b'%' | b'<' | b'>' | b'?' | b'`' | b'{' | b'}' | b'\\'
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

// `path.join()` and `path.resolve()` of node:path, for paths with forward slashes. `None`: the answer hangs on the working directory, or a part is written in another way.
fn join_paths(parts: &[Vec<u8>], resolves: bool) -> Option<Vec<u8>> {
    let first = match resolves {
        true => parts.iter().rposition(|part| is_absolute(part))?,
        false => 0,
    };
    let mut segments: Vec<&[u8]> = Vec::new();
    let root_length = match &parts.get(first)?[..] {
        [b'/', ..] => 1,
        part if is_absolute(part) => 3,
        _ => 0,
    };
    for (index, part) in parts[first..].iter().enumerate() {
        if strings::contains_char(part, b'\\') || strings::contains_char(part, 0) {
            return None;
        }
        let part = &part[if index == 0 { root_length } else { 0 }..];
        for segment in strings::split(part, b"/") {
            match segment {
                b"" | b"." => {}
                b".." if segments.last().is_some_and(|&last| last != b"..") => {
                    segments.pop();
                }
                b".." if root_length > 0 => {}
                _ => segments.push(segment),
            }
        }
    }
    let mut joined = parts[first][..root_length].to_vec();
    joined.extend_from_slice(&segments.join(&b"/"[..]));
    Some(joined)
}

// The path that an executable looks under for a relative one. Each `..` that leads out of its root stays, as `_.._`.
fn join_below_root(root: &[u8], relative: &[u8]) -> Vec<u8> {
    let mut kept: Vec<&[u8]> = Vec::new();
    for segment in strings::split(relative, b"/") {
        match (segment, kept.last()) {
            (b"" | b".", _) => {}
            (b"..", Some(&last)) if last != b"_.._" => {
                kept.pop();
            }
            (b"..", _) => kept.push(b"_.._"),
            _ => kept.push(segment),
        }
    }
    [root, &kept.join(&b"/"[..])].concat()
}

/// The file on disk that an executable holds under `named`, a path below its `root`.
fn find_path_on_disk(root_directory: &[u8], root: &[u8], named: &[u8]) -> Option<Vec<u8>> {
    let segments = strings::split(named.strip_prefix(root)?, b"/");
    let segments = segments.map(|it| if it == b"_.._" { &b".."[..] } else { it });
    let name = segments.collect::<Vec<_>>().join(&b"/"[..]);
    join_paths(&[with_separators_of_program(root_directory), name], true)
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

struct Walk<'a, 's> {
    files: &'a Files<'s>,
    search: &'a WorkerSearch<'a>,
    limits: &'a LimitValues,
    provider: &'a dyn SourceProvider,
    constructor: Option<BuiltinId>,
    url_constructor: Option<BuiltinId>,
    /// `URL.createObjectURL`
    object_url_maker: Option<BuiltinId>,
    blob_constructor: Option<BuiltinId>,
    /// node:worker_threads, node:path and node:url.
    modules: [Option<RuntimeModule>; 3],
    encoders: [(Option<BuiltinId>, Encoder); 2],
    variables_left: u64,
    parameters_left: u64,
    pending: Vec<(FileId, ExprId)>,
    has_options: bool,
    /// What is followed is the code itself: `{ eval: true }`.
    is_evaluated: bool,
    /// The `new Worker()` whose argument is followed.
    start: (FileId, ExprId),
    /// Each file with its `WorkerFile::has_options`.
    copies: Vec<(FileId, bool)>,
    texts: Vec<WorkerFile>,
    names: Vec<EntryPointPaths>,
    /// A Worker may start from what was not followed to its end, so from a text that is not among `texts`.
    has_unseen_start: bool,
    constructs_node_workers: bool,
}

pub(crate) struct CodeThatStartsWorkers {
    pub files: Vec<WorkerFile>,
    /// The names that are written for `files` and are not the paths of their modules: the path that each would have as a file of the executable, and the file on disk that it leads to.
    pub names: Vec<EntryPointPaths>,
    pub code: CodeOfWorkers,
    /// Some file calls `new` on the Worker of node:worker_threads.
    pub constructs_node_workers: bool,
}

// `import path from "./worker.js" with { type: "file" }; new Worker(path)`, `new Worker("./worker.js")` and `new Worker("data:text/javascript,..")`: the build has seen the code that the Worker runs, or finds it. What the constructor is given is followed back through variables, parameters and exports to the import, to the path or to the text. In the order of their paths.
pub(crate) fn find_code_that_starts_workers(
    files: &Files<'_>,
    search: &WorkerSearch<'_>,
    in_parallel: InParallel<'_>,
) -> CodeThatStartsWorkers {
    let &WorkerSearch {
        limits,
        loaders,
        provider,
        ..
    } = search;
    let url_constructor = table::find_name(b"URL").and_then(table::global);
    let mut walk = Walk {
        files,
        search,
        limits,
        provider,
        constructor: table::find_name(b"Worker").and_then(table::global),
        url_constructor,
        object_url_maker: url_constructor
            .zip(table::find_name(b"createObjectURL"))
            .and_then(|(holder, name)| table::own_member(holder, name))
            .map(table::canonical_id),
        blob_constructor: table::find_name(b"Blob").and_then(table::global),
        modules: [b"node:worker_threads".as_slice(), b"node:path", b"node:url"]
            .map(table::module_by_specifier),
        encoders: ENCODERS
            .map(|(name, encode)| (table::find_name(name).and_then(table::global), encode)),
        variables_left: 0,
        parameters_left: 0,
        pending: Vec::new(),
        has_options: false,
        is_evaluated: false,
        start: (FileId(0), ExprId(0)),
        copies: Vec::new(),
        texts: Vec::new(),
        names: Vec::new(),
        has_unseen_start: false,
        constructs_node_workers: false,
    };
    let compiled = files.compiled_files();
    let (constructor, worker_threads) = (walk.constructor, walk.modules[0]);
    let may_start_workers = map_each(compiled.to_vec(), in_parallel, &|file| {
        may_start_workers(files, file, constructor, worker_threads)
    });
    for (&file, _) in compiled.iter().zip(may_start_workers).filter(|it| it.1) {
        walk.visit_file(file);
    }
    let code = match walk.has_unseen_start {
        true => CodeOfWorkers::Unseen,
        false => CodeOfWorkers::Compiled,
    };
    let mut found: Vec<WorkerFile> = (walk.copies.iter())
        .filter_map(|&(copy, has_options)| {
            Some(WorkerFile {
                has_options,
                ..describe_embedded_file(files, loaders, copy)?
            })
        })
        .collect();
    found.append(&mut walk.texts);
    found.sort_unstable();
    found.dedup();
    walk.names.sort_unstable();
    walk.names.dedup();
    CodeThatStartsWorkers {
        files: found,
        names: walk.names,
        code,
        constructs_node_workers: walk.constructs_node_workers,
    }
}

fn find_module_answered(
    files: &Files<'_>,
    file: FileId,
    site: Option<usize>,
) -> Option<RuntimeModule> {
    let answer = site.and_then(|site| files.compiled(file)?.code_answers.get(site));
    match answer {
        Some(&CodeAnswer::HostModule(module)) => RuntimeModule::from_registry_id(module.0),
        _ => None,
    }
}

fn may_start_workers(
    files: &Files<'_>,
    file: FileId,
    constructor: Option<BuiltinId>,
    worker_threads: Option<RuntimeModule>,
) -> bool {
    let Some(source) = parsed_source(files, file) else {
        return false;
    };
    let is_constructor = |&id: &BuiltinId| Some(table::canonical_id(id)) == constructor;
    let mut sites = 0..files.analysis(file).import_sites.len();
    source.builtins.mentioned().iter().any(is_constructor)
        || sites.any(|site| {
            let module = find_module_answered(files, file, Some(site));
            module.is_some() && module == worker_threads
        })
}

// Every code file that the program embeds with the `file` loader, sorted by path.
pub(crate) fn find_embedded_code_files(
    files: &Files<'_>,
    loaders: &[(Vec<u8>, Loader)],
    in_parallel: InParallel<'_>,
) -> Vec<WorkerFile> {
    let compiled = files.compiled_files().to_vec();
    let described = map_each(compiled, in_parallel, &|file| {
        describe_embedded_file(files, loaders, file)
    });
    let mut copies: Vec<WorkerFile> = described.into_iter().flatten().collect();
    copies.sort_unstable();
    copies.dedup();
    copies
}

/// `WorkerFile::source_path` of a file that the load knows as `path`.
pub(crate) fn source_path_of(path: &[u8]) -> Vec<u8> {
    with_separators_of_host(to_native(path), cfg!(windows))
}

fn describe_embedded_file(
    files: &Files<'_>,
    loaders: &[(Vec<u8>, Loader)],
    copy: FileId,
) -> Option<WorkerFile> {
    let source = parsed_source(files, copy)?;
    let is_copy = source.kind == SourceKind::Data && source.loader == Loader::File;
    if !is_copy || source.is_from_plugin || source.plugin_module.is_some() {
        return None;
    }
    let path = files.module(copy).file_name();
    let is_code =
        loader_named_by_path(loaders, path).is_some_and(|loader| script_kind_of(loader).is_some());
    if !is_code {
        return None;
    }
    let hir = files.hir(copy);
    let embedded_path = hir.ids(hir.body).find_map(|statement| {
        let StmtKind::ExportDefault(value) = hir[statement].kind else {
            return None;
        };
        match hir[value].kind {
            ExprKind::String(path) => Some(files.atoms.bytes(path).to_vec()),
            _ => None,
        }
    })?;
    Some(WorkerFile {
        source_path: source_path_of(path),
        embedded_path,
        is_guess: false,
        has_options: false,
        started_at: None,
        text: None,
        is_named_by_path: false,
    })
}

impl Walk<'_, '_> {
    fn visit_file(&mut self, file: FileId) {
        let files = self.files;
        let Some(source) = parsed_source(files, file) else {
            return;
        };
        let (hir, bound) = (files.hir(file), files.bound(file));
        let decisions = &files.analysis(file).decisions;
        let mut callees: Vec<ExprId> = Vec::new();
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::New(call) = hir[expression].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[call].callee);
            let constructor = source.builtins.builtin_of_expression(callee);
            let starts_worker = match constructor {
                Some(constructor) => Some(table::canonical_id(constructor)) == self.constructor,
                None => self.is_worker_of_node(file, callee),
            };
            let is_evaluated = bound.parent_of_expr(expression) != Parent::None
                && !decisions.is_dead_expr(expression);
            if !starts_worker || !is_evaluated {
                continue;
            }
            callees.push(callee);
            self.constructs_node_workers |= constructor.is_none();
            let mut arguments = hir.ids(hir[call].args);
            if let Some(argument) = arguments.next() {
                let options = arguments.next();
                self.has_options = options.is_some();
                self.start = (file, expression);
                let is_text = constructor.is_none()
                    && options.is_some_and(|it| self.follow_evaluated_text(file, argument, it));
                if !is_text {
                    self.follow(file, argument);
                }
                if let Some(options) = options {
                    self.follow_preloads(file, options);
                }
            }
        }
        self.has_unseen_start |= !self.names_constructors_only_as(file, &callees);
    }

    /// Whether nothing but `callees` gets hold of a constructor of Workers in the file.
    fn names_constructors_only_as(&self, file: FileId, callees: &[ExprId]) -> bool {
        let files = self.files;
        let Some(source) = parsed_source(files, file) else {
            return false;
        };
        let (hir, bound, analysis) = (files.hir(file), files.bound(file), files.analysis(file));
        let is_threads =
            |module: Option<RuntimeModule>| module.is_some() && module == self.modules[0];
        let mut kinds = (analysis.import_sites.iter().enumerate())
            .filter(|&(site, _)| is_threads(self.find_module_answered(file, Some(site))))
            .map(|(_, site)| site.kind);
        let is_followed =
            |kind| matches!(kind, ImportSiteKind::Import(_) | ImportSiteKind::Require(_));
        let mut exported = (0..hir.export_specs.len() as u32).map(ExportSpecId);
        let is_import = |specifier| match bound.exported_binding(specifier) {
            Binding::Symbol(symbol) => {
                bound.binding_initializer(hir, symbol) == BindingInitializer::Import
            }
            _ => false,
        };
        if !kinds.all(is_followed) || exported.any(is_import) {
            return false;
        }
        let is_global = |expression| {
            let id = match source.builtins.of_expr(expression) {
                Some(Resolved::Builtin(path) | Resolved::DynamicGlobal(path)) => path.id,
                Some(Resolved::Intrinsic(Intrinsic::Builtin(id))) => id,
                Some(Resolved::Intrinsic(_)) | None => return false,
            };
            Some(table::canonical_id(id)) == self.constructor
        };
        (0..hir.exprs.len() as u32).map(ExprId).all(|expression| {
            let is_evaluated = bound.parent_of_expr(expression) != Parent::None
                && !analysis.decisions.is_dead_expr(expression);
            if !is_evaluated || callees.contains(&expression) {
                return true;
            }
            !is_global(expression)
                && !self.is_worker_of_node(file, expression)
                && (!is_threads(self.find_module(file, expression))
                    || self.is_read_by_names(file, expression))
        })
    }

    /// Of an expression that is a module of Bun's own: whether the file only reads members of it by names that are written there, each of which `find_member_of_module` finds.
    fn is_read_by_names(&self, file: FileId, module: ExprId) -> bool {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let keeps_to_itself = |name: PatId| match bound.initialized_binding(name) {
            Binding::Symbol(symbol) => {
                matches!(hir[name].kind, PatKind::Ident(_))
                    && bound.is_stable_binding(symbol)
                    && !is_exported(hir, bound, symbol)
            }
            _ => false,
        };
        match bound.parent_of_expr(module) {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Dot { obj, .. } => obj == module,
                _ => {
                    hir.skip_type_assertions(parent) == hir.skip_type_assertions(module)
                        && self.is_read_by_names(file, parent)
                }
            },
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Ident(_) => {
                    matches!(hir[module].kind, ExprKind::Call(_))
                        && keeps_to_itself(hir[declaration].pat)
                }
                PatKind::Object(properties) => properties.iter().all(|property| {
                    let has_name = matches!(hir.runtime_binding_key(property), PropKey::Name(_));
                    let property = &hir[property];
                    has_name
                        && !property.is_rest
                        && property.default.is_none()
                        && keeps_to_itself(property.value)
                }),
                PatKind::Array(_) | PatKind::Missing => false,
            },
            _ => false,
        }
    }

    // `import { Worker } from "node:worker_threads"`, `const { Worker } = require("node:worker_threads")` and `threads.Worker`
    fn is_worker_of_node(&self, file: FileId, callee: ExprId) -> bool {
        self.find_member_of_module(file, callee)
            .is_some_and(|(module, name)| {
                Some(module) == self.modules[0] && self.files.atoms.bytes(name) == b"Worker"
            })
    }

    /// The module of Bun's own and the name of its export that the expression reads.
    fn find_member_of_module(&self, file: FileId, member: ExprId) -> Option<(RuntimeModule, Atom)> {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        match hir[member].kind {
            ExprKind::Dot { obj, name, .. } => Some((self.find_module(file, obj)?, name)),
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(member) else {
                    return None;
                };
                if let &[Decl::ImportSpec(specifier)] = bound.symbol(symbol).decls {
                    let specifier = hir[specifier];
                    let kind = ImportSiteKind::Import(specifier.import);
                    let site = files.analysis(file).import_site_index(kind);
                    return Some((self.find_module_answered(file, site)?, specifier.imported));
                }
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::PatternProperty { source, path } => match path[..] {
                        [name] => Some((self.find_module(file, source)?, name)),
                        _ => None,
                    },
                    BindingInitializer::Expression(source) => {
                        let source = hir.skip_type_assertions(source);
                        match hir[source].kind {
                            ExprKind::Dot { .. } => self.find_member_of_module(file, source),
                            _ => None,
                        }
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn find_module(&self, file: FileId, module: ExprId) -> Option<RuntimeModule> {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let module = hir.skip_type_assertions(module);
        match hir[module].kind {
            ExprKind::Call(_) => {
                let site = files.analysis(file).import_site_of_call(module);
                self.find_module_answered(file, site)
            }
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(module) else {
                    return None;
                };
                if let &[Decl::ImportNamespace(import) | Decl::ImportDefault(import)] =
                    bound.symbol(symbol).decls
                {
                    let kind = ImportSiteKind::Import(import);
                    let site = files.analysis(file).import_site_index(kind);
                    return self.find_module_answered(file, site);
                }
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Expression(source) => {
                        let source = hir.skip_type_assertions(source);
                        match hir[source].kind {
                            ExprKind::Call(_) => self.find_module(file, source),
                            _ => None,
                        }
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn find_module_answered(&self, file: FileId, site: Option<usize>) -> Option<RuntimeModule> {
        find_module_answered(self.files, file, site)
    }

    fn follow(&mut self, file: FileId, argument: ExprId) {
        let (files, limits) = (self.files, self.limits);
        self.variables_left = limits.get(LimitId::MaxVariablesFollowedToLoader);
        self.parameters_left = limits.get(LimitId::MaxParametersFollowedToLoader);
        self.pending.push((file, argument));
        while let Some((file, expression)) = self.pending.pop() {
            let hir = files.hir(file);
            let expression = hir.skip_type_assertions(expression);
            if files.analysis(file).decisions.is_dead_expr(expression) {
                continue;
            }
            let variables_left = self.variables_left;
            let text = self.find_text(file, expression);
            if let Some(text) = &text
                && (self.add_evaluated_text(text) || self.add_url(text) || self.add_path(text))
            {
                continue;
            }
            self.variables_left = variables_left;
            // A path under which the executable holds no code starts no Worker, whatever else the expression leads to.
            let is_path = text.is_some_and(|text| !is_name_of_text(&text));
            let had_unseen_start = self.has_unseen_start;
            match hir[expression].kind {
                ExprKind::Call(call) if !self.is_evaluated => {
                    self.has_unseen_start |= self.follow_object_url(file, call).is_none();
                }
                ExprKind::Cond { branches, .. } => {
                    let Branches { yes, no } = hir.branches(branches);
                    self.pending.extend([(file, yes), (file, no)]);
                }
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    left,
                    right,
                } => self.pending.extend([(file, left), (file, right)]),
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    right,
                    ..
                } => self.pending.push((file, right)),
                ExprKind::Dot { obj, name, .. } if name == known::default => {
                    self.follow_default_of(file, obj);
                }
                ExprKind::Ident(_) => self.follow_name(file, expression),
                _ => self.has_unseen_start = true,
            }
            if is_path {
                self.has_unseen_start = had_unseen_start;
            }
        }
    }

    /// What `BoundIn::binding_initializer` answers. A variable that is stored to may hold something else.
    fn find_initializer_of(&mut self, file: FileId, symbol: SymbolId) -> BindingInitializer {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let initializer = bound.binding_initializer(hir, symbol);
        self.has_unseen_start |=
            initializer != BindingInitializer::Import && !bound.is_stable_binding(symbol);
        initializer
    }

    // What the constructor of a Worker makes of the value that the expression always evaluates to, if that is a text or a URL: a constant, or constants and the path of the file itself that `+`, a template, `encodeURIComponent()`, `btoa()`, `new URL()` and the functions of node:path and node:url put together. A path is what the program sees when it runs, with forward slashes.
    fn find_text(&mut self, file: FileId, expression: ExprId) -> Option<Vec<u8>> {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let expression = hir.skip_type_assertions(expression);
        match (files.analysis(file).decisions).constant(hir, expression) {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => {
                return Some(files.atoms.bytes(text).to_vec());
            }
            FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_) => return None,
            FoldedValue::Unknown => {}
        }
        match hir[expression].kind {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                let mut text = self.find_text(file, left)?;
                text.append(&mut self.find_text(file, right)?);
                Some(text)
            }
            ExprKind::Template { exprs } => {
                let mut texts = hir.ids(hir.template_texts(exprs));
                let mut text = files.atoms.bytes(texts.next()?).to_vec();
                for (substitution, following) in hir.ids(exprs).zip(texts) {
                    text.append(&mut self.find_text(file, substitution)?);
                    text.extend_from_slice(files.atoms.bytes(following));
                }
                Some(text)
            }
            ExprKind::New(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                let constructor = self.find_builtin(file, callee)?;
                let mut arguments = hir.ids(hir[call].args);
                let written = arguments.next()?;
                if Some(constructor) != self.url_constructor {
                    return None;
                }
                let written = self.find_text(file, written)?;
                match arguments.next() {
                    None => self.provider.write_url(&written, None),
                    Some(base) => {
                        let base = self.find_text(file, base)?;
                        self.provider.write_url(&written, Some(&base))
                    }
                }
            }
            ExprKind::Call(call) => self.find_text_of_call(file, expression, call),
            ExprKind::Dot { obj, name, .. } => self.find_text_of_member(file, obj, name),
            ExprKind::Ident(_) => match bound.binding(expression) {
                Binding::CommonJs(CommonJsVariable::Filename) => self.find_own_path(file),
                Binding::CommonJs(CommonJsVariable::Dirname) => {
                    Some(dirname::<Posix>(&self.find_own_path(file)?).to_vec())
                }
                Binding::Symbol(symbol) if self.variables_left > 0 => {
                    self.variables_left -= 1;
                    match self.find_initializer_of(file, symbol) {
                        BindingInitializer::Expression(source) => self.find_text(file, source),
                        _ => None,
                    }
                }
                _ => None,
            },
            _ => None,
        }
    }

    fn find_builtin(&self, file: FileId, expression: ExprId) -> Option<BuiltinId> {
        let builtins = &parsed_source(self.files, file)?.builtins;
        builtins
            .builtin_of_expression(expression)
            .map(table::canonical_id)
    }

    /// The path of the module as the program sees it when it runs, with forward slashes.
    fn find_own_path(&self, file: FileId) -> Option<Vec<u8>> {
        let path = self.files.module(file).file_name();
        if is_host_path(path) {
            return None;
        }
        let search = self.search;
        if search.runs_in_place {
            return Some(to_native(path).to_vec());
        }
        let mut entry_points = self.files.entry_points().iter();
        let name = match entry_points.position(|&entry_point| entry_point == file) {
            Some(index) => search.paths.entry_point_names.get(index)?.clone(),
            None => compute_relative_path(&search.paths.root_directory, to_native(path))?,
        };
        Some(with_forward_slashes(compute_module_path(
            search.paths,
            &name,
        )))
    }

    fn find_text_of_member(&mut self, file: FileId, object: ExprId, name: Atom) -> Option<Vec<u8>> {
        let files = self.files;
        let hir = files.hir(file);
        let object = hir.skip_type_assertions(object);
        let name = files.atoms.bytes(name);
        if matches!(hir[object].kind, ExprKind::ImportMeta) {
            if files.bound(file).import_meta_may_be_modified() {
                return None;
            }
            let path = self.find_own_path(file)?;
            return match name {
                b"path" | b"filename" => Some(path),
                b"dir" | b"dirname" => Some(dirname::<Posix>(&path).to_vec()),
                b"url" => write_file_url(&path),
                _ => None,
            };
        }
        match (name, self.is_url(file, object)) {
            (b"href", true) => self.find_text(file, object),
            _ => None,
        }
    }

    // `new URL(..)` and `pathToFileURL(..)`, also in a variable.
    fn is_url(&self, file: FileId, expression: ExprId) -> bool {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let expression = hir.skip_type_assertions(expression);
        match hir[expression].kind {
            ExprKind::New(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                let constructor = self.find_builtin(file, callee);
                constructor.is_some() && constructor == self.url_constructor
            }
            ExprKind::Call(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                (self.find_member_of_module(file, callee)).is_some_and(|(module, name)| {
                    Some(module) == self.modules[2] && files.atoms.bytes(name) == b"pathToFileURL"
                })
            }
            ExprKind::Ident(_) => match bound.binding(expression) {
                Binding::Symbol(symbol) => match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Expression(source) => {
                        let source = hir.skip_type_assertions(source);
                        !matches!(hir[source].kind, ExprKind::Ident(_)) && self.is_url(file, source)
                    }
                    _ => false,
                },
                _ => false,
            },
            _ => false,
        }
    }

    fn find_text_of_call(
        &mut self,
        file: FileId,
        expression: ExprId,
        call: CallId,
    ) -> Option<Vec<u8>> {
        let files = self.files;
        let hir = files.hir(file);
        let analysis = files.analysis(file);
        if let Some(site) = analysis.import_site_of_call(expression) {
            let &CodeAnswer::File(found) = files.compiled(file)?.code_answers.get(site)? else {
                return None;
            };
            let path = self.find_own_path(found)?;
            return match analysis.import_sites[site].kind {
                ImportSiteKind::RequireResolve(_) => Some(path),
                ImportSiteKind::ImportMetaResolve(_) => write_file_url(&path),
                _ => None,
            };
        }
        let callee = hir.skip_type_assertions(hir[call].callee);
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        if let Some(function) = self.find_builtin(file, callee) {
            let encode = (self.encoders.iter()).find(|it| it.0 == Some(function))?.1;
            return encode(&self.find_text(file, *arguments.first()?)?);
        }
        if let Some((module, name)) = self.find_member_of_module(file, callee) {
            let name = files.atoms.bytes(name);
            let position = self.modules.iter().position(|&it| it == Some(module))?;
            return match (position, name) {
                (1, b"join" | b"resolve") => {
                    let parts: Option<Vec<Vec<u8>>> = (arguments.iter())
                        .map(|&argument| self.find_text(file, argument))
                        .collect();
                    join_paths(&parts?, name == b"resolve")
                }
                (2, b"fileURLToPath") => {
                    let url = self.find_text(file, *arguments.first()?)?;
                    read_file_url(&url)
                }
                (2, b"pathToFileURL") => {
                    let path = self.find_text(file, *arguments.first()?)?;
                    write_file_url(&path)
                }
                _ => None,
            };
        }
        match hir[callee].kind {
            ExprKind::Dot { obj, name, .. }
                if matches!(files.atoms.bytes(name), b"toString" | b"toJSON")
                    && self.is_url(file, obj) =>
            {
                self.find_text(file, obj)
            }
            _ => None,
        }
    }

    /// False: the text is no URL that holds code.
    fn add_url(&mut self, url: &[u8]) -> bool {
        if !is_url_with_text(url) {
            return false;
        }
        // `bun run` reads what a `data:` URL holds as TypeScript with JSX, whatever type the URL names.
        match self.provider.decode_data_url(url) {
            Some(contents) => self.add_text(url.to_vec(), contents, Loader::Tsx),
            None => self.has_unseen_start = true,
        }
        true
    }

    fn add_text(&mut self, name: Vec<u8>, contents: Vec<u8>, loader: Loader) {
        self.texts.push(WorkerFile {
            source_path: name.clone(),
            embedded_path: name,
            is_guess: false,
            has_options: self.has_options,
            started_at: Some(self.position_of_start()),
            text: Some((contents, loader as u8)),
            is_named_by_path: false,
        });
    }

    /// False: the text is no code, it says where the code is.
    fn add_evaluated_text(&mut self, text: &[u8]) -> bool {
        if self.is_evaluated {
            self.add_text_of_blob(text.to_vec(), None);
        }
        self.is_evaluated
    }

    // The run time knows the text behind an object URL by what it says.
    fn add_text_of_blob(&mut self, contents: Vec<u8>, r#type: Option<&[u8]>) {
        let loader = self.provider.loader_of_blob(r#type);
        match loader.filter(|it| LOADERS_OF_CODE.contains(it)) {
            Some(loader) => self.add_text(name_of_text(loader, &contents), contents, loader),
            None => self.has_unseen_start = true,
        }
    }

    /// The value of the property in an object literal that says nothing else about it. `Err`: the expression is no such literal.
    fn find_property(
        &self,
        file: FileId,
        object: ExprId,
        name: &[u8],
    ) -> Result<Option<ExprId>, ()> {
        let hir = self.files.hir(file);
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(object)].kind else {
            return Err(());
        };
        let mut found = None;
        for property in properties.iter().map(|property| hir[property]) {
            let key = property.key.name().ok_or(())?;
            if self.files.atoms.bytes(key) != name {
                continue;
            }
            found = match property.kind {
                PropKind::Init => Some(property.value),
                _ => return Err(()),
            };
        }
        Ok(found)
    }

    // `new Worker(text, { eval: true })` of node:worker_threads, which makes a Blob without a type of the text.
    fn follow_evaluated_text(&mut self, file: FileId, text: ExprId, options: ExprId) -> bool {
        let evaluates = match self.find_property(file, options, b"eval") {
            Ok(Some(evaluates)) => evaluates,
            Ok(None) => return false,
            Err(()) => {
                self.has_unseen_start = true;
                return false;
            }
        };
        let decisions = &self.files.analysis(file).decisions;
        match decisions.constant(self.files.hir(file), evaluates) {
            FoldedValue::Constant(Constant::Boolean(true)) => {}
            FoldedValue::Constant(Constant::Boolean(false)) => return false,
            _ => {
                self.has_unseen_start = true;
                return false;
            }
        }
        self.is_evaluated = true;
        self.follow(file, text);
        self.is_evaluated = false;
        true
    }

    // `new Worker(path, { preload: "./first.ts" })` and `{ preload: ["./first.ts", ..] }`: the Worker loads those files in front of its own.
    fn follow_preloads(&mut self, file: FileId, options: ExprId) {
        self.variables_left = (self.limits).get(LimitId::MaxVariablesFollowedToLoader);
        let mut names = Vec::new();
        self.find_preloads(file, options, &mut names);
        for name in names {
            self.follow(file, name);
        }
    }

    /// Adds what every `preload` names that the object literal writes, or a literal that it spreads.
    fn find_preloads(&mut self, file: FileId, options: ExprId, names: &mut Vec<ExprId>) {
        let (hir, atoms) = (self.files.hir(file), &self.files.atoms);
        let ExprKind::Object(properties) = hir[self.find_initializer(file, options)].kind else {
            return;
        };
        for property in properties.iter().map(|property| hir[property]) {
            let key = property.key.name();
            match property.kind {
                PropKind::Spread => self.find_preloads(file, property.value, names),
                PropKind::Init | PropKind::Shorthand
                    if key.is_some_and(|key| atoms.bytes(key) == b"preload") =>
                {
                    let preload = self.find_initializer(file, property.value);
                    match hir[preload].kind {
                        ExprKind::Array(list) => names.extend(hir.ids(list)),
                        _ => names.push(preload),
                    }
                }
                _ => {}
            }
        }
    }

    // `URL.createObjectURL(new Blob([text, ..], { type }))`
    fn follow_object_url(&mut self, file: FileId, call: CallId) -> Option<()> {
        let hir = self.files.hir(file);
        let callee = hir.skip_type_assertions(hir[call].callee);
        if self.find_builtin(file, callee)? != self.object_url_maker? {
            return None;
        }
        let blob = self.find_initializer(file, hir.ids(hir[call].args).next()?);
        let ExprKind::New(blob) = hir[blob].kind else {
            return None;
        };
        let constructor = hir.skip_type_assertions(hir[blob].callee);
        if self.find_builtin(file, constructor)? != self.blob_constructor? {
            return None;
        }
        let mut arguments = hir.ids(hir[blob].args);
        let written = arguments.next()?;
        let parts = self.find_initializer(file, written);
        // Whoever else holds the list can add to it.
        self.has_unseen_start |= parts != hir.skip_type_assertions(written);
        let ExprKind::Array(parts) = hir[parts].kind else {
            return None;
        };
        let mut contents = Vec::new();
        for part in hir.ids(parts) {
            let is_text = !self.is_url(file, part);
            contents.append(&mut self.find_text(file, part).filter(|_| is_text)?);
        }
        if !is_valid_utf8(&contents) {
            return None;
        }
        let r#type = match arguments.next() {
            None => None,
            Some(options) => match self.find_property(file, options, b"type").ok()? {
                None => None,
                Some(written) => Some(self.find_text(file, written)?),
            },
        };
        self.add_text_of_blob(contents, r#type.as_deref());
        Some(())
    }

    /// What a variable that is never assigned again was declared with, or the expression itself.
    fn find_initializer(&mut self, file: FileId, expression: ExprId) -> ExprId {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let expression = hir.skip_type_assertions(expression);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (hir[expression].kind, bound.binding(expression))
        else {
            return expression;
        };
        match self.find_initializer_of(file, symbol) {
            BindingInitializer::Expression(source) if self.variables_left > 0 => {
                self.variables_left -= 1;
                self.find_initializer(file, source)
            }
            _ => expression,
        }
    }

    /// False: the text is no path under which the executable would hold a file of code that the build finds. An executable looks in its own root for what a relative path names.
    fn add_path(&mut self, text: &[u8]) -> bool {
        let &WorkerSearch {
            paths,
            runs_in_place,
            resolve_entry_point,
            resolve_bare_name,
            ..
        } = self.search;
        let root = match runs_in_place {
            true => with_separators_of_program(&paths.root_directory),
            false => with_forward_slashes(paths.module_prefix.clone()),
        };
        // A package names the file of a Worker that most programs never start, and the program of such a file is no small one.
        let starts_in = self.files.module(self.start.0).file_name();
        if is_in_node_modules(starts_in) {
            return false;
        }
        let is_relative = text.starts_with(b"./") || text.starts_with(b"../");
        let named = match text.starts_with(b"file:") {
            true => read_file_url(text),
            false if is_relative && !runs_in_place => Some(join_below_root(&root, text)),
            false if is_relative || is_absolute(text) => {
                join_paths(&[root.clone(), text.to_vec()], true)
            }
            false => None,
        };
        // No extension is added to such a name, so it is not the same name without its end.
        let names_directory =
            matches!(text, [.., b'/'] | [.., b'/', b'.'] | [.., b'/', b'.', b'.']);
        let find_on_disk = |named: &[u8]| {
            let mut written = match runs_in_place {
                true => named.to_vec(),
                false => find_path_on_disk(&paths.root_directory, &root, named)?,
            };
            if names_directory {
                written.push(b'/');
            }
            resolve_entry_point(&written)
        };
        let is_written_down = !runs_in_place && !names_directory;
        let Some(named) = named else {
            let Some(path) = resolve_bare_name(text) else {
                return false;
            };
            if !is_written_down {
                return self.add_file(&path, None);
            }
            // The executable looks below `node_modules` for the name, then in its root.
            let in_root = join_below_root(&root, text);
            let named = match find_on_disk(&in_root).is_some_and(|found| found == path) {
                true => in_root,
                false => join_below_root(&root, &[b"node_modules/", text].concat()),
            };
            return self.add_file(&path, Some(&named));
        };
        // What `..` makes of a path in the root lies beside the root. The executable holds what lies beside the root directory under `_.._`.
        let above_root = dirname::<Posix>(root.strip_suffix(b"/").unwrap_or(&root));
        let beside_root = (named.strip_prefix(above_root)).filter(|rest| rest.starts_with(b"/"));
        let named = match beside_root {
            Some(rest) if !runs_in_place && !named.starts_with(&root) => {
                [&root[..], b"_.._", rest].concat()
            }
            Some(_) | None => named,
        };
        let found = find_on_disk(&named);
        found.is_some_and(|path| self.add_file(&path, is_written_down.then_some(&named[..])))
    }

    /// `named`: the path under which the executable is to find the file.
    fn add_file(&mut self, path: &[u8], named: Option<&[u8]>) -> bool {
        let &WorkerSearch {
            loaders,
            paths,
            runs_in_place,
            ..
        } = self.search;
        let is_code = loader_named_by_path(loaders, path)
            .is_some_and(|loader| script_kind_of(loader).is_some());
        let native_path = to_native(path);
        let Some(name) = compute_relative_path(&paths.root_directory, native_path) else {
            return false;
        };
        let embedded_path = match runs_in_place {
            true => native_path.to_vec(),
            false => [&paths.module_prefix[..], &name[..]].concat(),
        };
        if !is_code || is_host_path(path) {
            return false;
        }
        let held_as = with_forward_slashes(compute_module_path(paths, &name));
        if let Some(named) = named.filter(|&named| named != held_as) {
            self.names.push(EntryPointPaths {
                public_path: named.to_vec(),
                source_path: source_path_of(path),
            });
        }
        self.texts.push(WorkerFile {
            source_path: source_path_of(path),
            embedded_path,
            is_guess: false,
            has_options: self.has_options,
            started_at: Some(self.position_of_start()),
            text: None,
            is_named_by_path: true,
        });
        true
    }

    fn position_of_start(&self) -> ShownPosition {
        let (file, start) = self.start;
        let offset = self.files.hir(file)[start].pos;
        let unlocated = new_driver_diagnostic(0, Category::Message, Vec::new(), &[]);
        let located = Locator::new(self.files, file).locate(offset, offset, unlocated);
        let line = located.line.saturating_sub(located.source_line) as usize;
        ShownPosition {
            position: position_of_diagnostic(&located),
            line_text: located.source.get(line).cloned().unwrap_or_default(),
        }
    }

    // `(await import("./worker.js", { with: { type: "file" } })).default`
    fn follow_default_of(&mut self, file: FileId, namespace: ExprId) {
        let hir = self.files.hir(file);
        let ExprKind::Await(promise) = hir[hir.skip_type_assertions(namespace)].kind else {
            self.has_unseen_start = true;
            return;
        };
        let call = hir.skip_type_assertions(promise);
        let site = self.files.analysis(file).import_site_of_call(call);
        self.follow_export(file, site, known::default);
    }

    fn follow_name(&mut self, file: FileId, mention: ExprId) {
        let files = self.files;
        let bound = files.bound(file);
        let Binding::Symbol(symbol) = bound.binding(mention) else {
            self.has_unseen_start = true;
            return;
        };
        if !matches!(bound.symbol(symbol).decls, [Decl::Param(_)]) {
            return self.follow_symbol(file, symbol);
        }
        let is_loaded = parsed_source(files, file).is_some() && files.compiled(file).is_some();
        if !is_loaded || self.parameters_left == 0 {
            self.has_unseen_start = true;
            return;
        }
        self.parameters_left -= 1;
        let (hir, decisions) = (files.hir(file), &files.analysis(file).decisions);
        match find_values_of_parameter(hir, bound, decisions, mention) {
            Some(values) => self.pending.extend(values.iter().map(|&it| (file, it))),
            None => self.has_unseen_start = true,
        }
    }

    fn follow_symbol(&mut self, file: FileId, symbol: SymbolId) {
        let files = self.files;
        if self.variables_left == 0 {
            self.has_unseen_start = true;
            return;
        }
        self.variables_left -= 1;
        match self.find_initializer_of(file, symbol) {
            BindingInitializer::Expression(source) => self.pending.push((file, source)),
            BindingInitializer::PatternProperty { source, path }
                if path[..] == [known::default] =>
            {
                self.follow_default_of(file, source);
            }
            BindingInitializer::Import => match find_import_of(files, file, symbol) {
                Some((import, name)) => {
                    let kind = ImportSiteKind::Import(import);
                    let site = files.analysis(file).import_site_index(kind);
                    self.follow_export(file, site, name);
                }
                None => self.has_unseen_start = true,
            },
            _ => self.has_unseen_start = true,
        }
    }

    fn follow_export(&mut self, importer: FileId, site: Option<usize>, name: Atom) {
        self.has_unseen_start |= !self.follow_declarations_of_export(importer, site, name);
    }

    /// False: what the name is exported with is not all followed.
    fn follow_declarations_of_export(
        &mut self,
        importer: FileId,
        site: Option<usize>,
        name: Atom,
    ) -> bool {
        let files = self.files;
        let answer = site.and_then(|site| files.compiled(importer)?.code_answers.get(site));
        let Some(&CodeAnswer::File(exporter)) = answer else {
            return false;
        };
        let is_copy = parsed_source(files, exporter)
            .is_some_and(|it| it.kind == SourceKind::Data && it.loader == Loader::File);
        if is_copy {
            let is_path = name == known::default && !self.is_evaluated;
            if is_path {
                self.copies.push((exporter, self.has_options));
            }
            return is_path;
        }
        if files.compiled(exporter).is_none() {
            return false;
        }
        let (hir, bound) = (files.hir(exporter), files.bound(exporter));
        let exports = bound.table(bound.symbol(bound.file_symbol).exports);
        let Some(&(_, export)) = exports.iter().find(|entry| entry.0 == name) else {
            return false;
        };
        let mut follows_all = true;
        for &declaration in bound.symbol(export).decls {
            match declaration {
                Decl::ExportSpec(specifier) => {
                    let item = hir[specifier];
                    let statement = hir[item.export];
                    if item.type_only || statement.type_only {
                        continue;
                    }
                    if statement.has_module_specifier && self.variables_left > 0 {
                        self.variables_left -= 1;
                        let kind = ImportSiteKind::ExportFrom(item.export);
                        let site = files.analysis(exporter).import_site_index(kind);
                        self.follow_export(exporter, site, item.local);
                    } else if statement.has_module_specifier {
                        follows_all = false;
                    } else if let Binding::Symbol(local) = bound.exported_binding(specifier) {
                        self.follow_symbol(exporter, local);
                    } else {
                        follows_all = false;
                    }
                }
                Decl::Var(_) => self.follow_symbol(exporter, bound.declared_symbol(declaration)),
                Decl::ExportExpr(statement) => match hir[statement].kind {
                    StmtKind::ExportDefault(value) => self.pending.push((exporter, value)),
                    _ => follows_all = false,
                },
                _ => follows_all = false,
            }
        }
        follows_all
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_joined_as_node_path_joins_them() {
        let join = |parts: &[&str], resolves: bool| {
            let parts: Vec<Vec<u8>> = parts.iter().map(|part| part.as_bytes().to_vec()).collect();
            join_paths(&parts, resolves)
        };
        let is = |path: &str| Some(path.as_bytes().to_vec());
        assert_eq!(join(&["/a/b", "w.js"], false), is("/a/b/w.js"));
        assert_eq!(join(&["/a/b", "./c/../w.js"], false), is("/a/b/w.js"));
        assert_eq!(join(&["/a/b", "../../../w.js"], false), is("/w.js"));
        assert_eq!(join(&["/a/b", "/w.js"], false), is("/a/b/w.js"));
        assert_eq!(join(&["a", "../../w.js"], false), is("../w.js"));
        assert_eq!(join(&["/a/b", "/c", "w.js"], true), is("/c/w.js"));
        assert_eq!(join(&["/a/b", "../w.js"], true), is("/a/w.js"));
        assert_eq!(join(&["a", "w.js"], true), None);
        assert_eq!(join(&["/a", "b\\w.js"], false), None);
    }

    #[test]
    fn a_relative_path_that_leads_out_of_the_root_keeps_its_steps() {
        let join = |relative: &str| join_below_root(b"/$bunfs/root/", relative.as_bytes());
        assert_eq!(join("./a/../w.js"), b"/$bunfs/root/w.js");
        assert_eq!(join("../w.js"), b"/$bunfs/root/_.._/w.js");
        assert_eq!(
            join("./a/../../../b/./w.js"),
            b"/$bunfs/root/_.._/_.._/b/w.js"
        );
    }

    #[test]
    fn a_path_in_the_executable_leads_to_the_file_on_disk() {
        let find = |directory: &str, root: &str, named: &str| {
            find_path_on_disk(directory.as_bytes(), root.as_bytes(), named.as_bytes())
        };
        let is = |path: &str| Some(path.as_bytes().to_vec());
        let posix = "/$bunfs/root/";
        assert_eq!(find("/a/b", posix, "/$bunfs/root/w.cjs"), is("/a/b/w.cjs"));
        assert_eq!(find("/a/b", posix, "/$bunfs/root/_.._/w.js"), is("/a/w.js"));
        assert_eq!(find("/a/b", posix, "/elsewhere/w.js"), None);
        let windows = "B:/~BUN/root/";
        assert_eq!(
            find("C:\\a\\b", windows, "B:/~BUN/root/w.cjs"),
            is("C:/a/b/w.cjs")
        );
        assert_eq!(
            find("C:\\a\\b", windows, "B:/~BUN/root/_.._/lib/w.js"),
            is("C:/a/lib/w.js")
        );
    }

    #[test]
    fn a_path_comes_back_out_of_its_url() {
        for path in ["/$bunfs/root/a b/w#1%.js", "B:/~BUN/root/w.js"] {
            let url = write_file_url(path.as_bytes()).expect("the path is absolute");
            assert_eq!(read_file_url(&url).as_deref(), Some(path.as_bytes()));
        }
        let url = write_file_url(b"B:/~BUN/root/a b.js");
        assert_eq!(url.as_deref(), Some(&b"file:///B:/~BUN/root/a%20b.js"[..]));
        assert_eq!(write_file_url(b"w.js"), None);
        assert_eq!(read_file_url(b"file:///a.js?b"), None);
        assert_eq!(read_file_url(b"file://host/a.js"), None);
    }
}
