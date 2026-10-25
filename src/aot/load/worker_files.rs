use bun_ast::Loader;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, Decl, Parent, SymbolId};
use bun_sema::hir::{BinOp, Branches, ExprId, ExprKind, StmtKind};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{CodeAnswer, FileId, Files};
use bun_sema_driver::host::to_native;

use crate::builtins::{BuiltinId, RuntimeModule, table};
use crate::diagnostics::ShownPosition;
use crate::load::SourceKind;
use crate::load::loaders::{loader_named_by_path, script_kind_of};
use crate::load::module_paths::with_separators_of_host;
use crate::load::named_loads::{find_import_of, find_values_of_parameter};
use crate::load::sources::parsed_source;
use crate::statistics::{LimitId, LimitValues};

/// A file of code that the program embeds with the `file` loader and starts a Worker with.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct WorkerFile {
    pub source_path: Vec<u8>,
    /// What the import answers: the path of the copy in the executable.
    pub embedded_path: Vec<u8>,
    /// The compiler lost track of the path and some Worker gets an unknown value, or another native function looks at the path too.
    pub is_guess: bool,
    /// The Worker may also get an options object.
    pub has_options: bool,
    /// Of a file that the engine reported: one `new Worker()` that may get the path.
    pub started_at: Option<ShownPosition>,
}

struct Walk<'a, 's> {
    files: &'a Files<'s>,
    limits: &'a LimitValues,
    constructor: Option<BuiltinId>,
    variables_left: u64,
    parameters_left: u64,
    pending: Vec<(FileId, ExprId)>,
    has_options: bool,
    /// Each file with its `WorkerFile::has_options`.
    copies: Vec<(FileId, bool)>,
}

// `import path from "./worker.js" with { type: "file" }; new Worker(path)`: the build has seen the code that the Worker runs. What the constructor is given is followed back through variables, parameters and exports to the import. In the order of their paths.
pub(crate) fn find_embedded_files_that_start_workers(
    files: &Files<'_>,
    limits: &LimitValues,
    loaders: &[(Vec<u8>, Loader)],
) -> Vec<WorkerFile> {
    let mut walk = Walk {
        files,
        limits,
        constructor: table::find_name(b"Worker").and_then(table::global),
        variables_left: 0,
        parameters_left: 0,
        pending: Vec::new(),
        has_options: false,
        copies: Vec::new(),
    };
    for &file in files.compiled_files() {
        walk.visit_file(file);
    }
    let mut found: Vec<WorkerFile> = (walk.copies.iter())
        .filter_map(|&(copy, has_options)| {
            Some(WorkerFile {
                has_options,
                ..describe_embedded_file(files, loaders, copy)?
            })
        })
        .collect();
    found.sort_unstable();
    found.dedup();
    found
}

// Every code file that the program embeds with the `file` loader, sorted by path.
pub(crate) fn find_embedded_code_files(
    files: &Files<'_>,
    loaders: &[(Vec<u8>, Loader)],
) -> Vec<WorkerFile> {
    let compiled = files.compiled_files().iter();
    let mut copies: Vec<WorkerFile> = compiled
        .filter_map(|&file| describe_embedded_file(files, loaders, file))
        .collect();
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
    let path = files.module(copy).file_name();
    let is_copy = source.kind == SourceKind::Data && source.loader == Loader::File;
    let is_code =
        loader_named_by_path(loaders, path).is_some_and(|loader| script_kind_of(loader).is_some());
    if !is_copy || !is_code || source.is_from_plugin || source.plugin_module.is_some() {
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
            let mut arguments = hir.ids(hir[call].args);
            if let Some(argument) = arguments.next() {
                self.has_options = arguments.next().is_some();
                self.follow(file, argument);
            }
        }
    }

    // `import { Worker } from "node:worker_threads"`
    fn is_worker_of_node(&self, file: FileId, callee: ExprId) -> bool {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (hir[callee].kind, bound.binding(callee))
        else {
            return false;
        };
        let &[Decl::ImportSpec(specifier)] = bound.symbol(symbol).decls else {
            return false;
        };
        let specifier = hir[specifier];
        let kind = ImportSiteKind::Import(specifier.import);
        let site = files.analysis(file).import_site_index(kind);
        let answer = site.and_then(|site| files.compiled(file)?.code_answers.get(site));
        let Some(&CodeAnswer::HostModule(module)) = answer else {
            return false;
        };
        files.atoms.bytes(specifier.imported) == b"Worker"
            && RuntimeModule::from_registry_id(module.0)
                == table::module_by_specifier(b"node:worker_threads")
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
            match hir[expression].kind {
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
                _ => {}
            }
        }
    }

    // `(await import("./worker.js", { with: { type: "file" } })).default`
    fn follow_default_of(&mut self, file: FileId, namespace: ExprId) {
        let hir = self.files.hir(file);
        let ExprKind::Await(promise) = hir[hir.skip_type_assertions(namespace)].kind else {
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
            return;
        };
        if !matches!(bound.symbol(symbol).decls, [Decl::Param(_)]) {
            return self.follow_symbol(file, symbol);
        }
        let is_loaded = parsed_source(files, file).is_some() && files.compiled(file).is_some();
        if !is_loaded || self.parameters_left == 0 {
            return;
        }
        self.parameters_left -= 1;
        let (hir, decisions) = (files.hir(file), &files.analysis(file).decisions);
        let values = find_values_of_parameter(hir, bound, decisions, mention).unwrap_or_default();
        self.pending.extend(values.iter().map(|&it| (file, it)));
    }

    fn follow_symbol(&mut self, file: FileId, symbol: SymbolId) {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        if self.variables_left == 0 {
            return;
        }
        self.variables_left -= 1;
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) => self.pending.push((file, source)),
            BindingInitializer::PatternProperty { source, path }
                if path[..] == [known::default] =>
            {
                self.follow_default_of(file, source);
            }
            BindingInitializer::Import => {
                if let Some((import, name)) = find_import_of(files, file, symbol) {
                    let kind = ImportSiteKind::Import(import);
                    let site = files.analysis(file).import_site_index(kind);
                    self.follow_export(file, site, name);
                }
            }
            _ => {}
        }
    }

    fn follow_export(&mut self, importer: FileId, site: Option<usize>, name: Atom) {
        let files = self.files;
        let answer = site.and_then(|site| files.compiled(importer)?.code_answers.get(site));
        let Some(&CodeAnswer::File(exporter)) = answer else {
            return;
        };
        let is_copy = parsed_source(files, exporter)
            .is_some_and(|it| it.kind == SourceKind::Data && it.loader == Loader::File);
        if is_copy {
            if name == known::default {
                self.copies.push((exporter, self.has_options));
            }
            return;
        }
        if files.compiled(exporter).is_none() {
            return;
        }
        let (hir, bound) = (files.hir(exporter), files.bound(exporter));
        let exports = bound.table(bound.symbol(bound.file_symbol).exports);
        let Some(&(_, export)) = exports.iter().find(|entry| entry.0 == name) else {
            return;
        };
        for &declaration in bound.symbol(export).decls {
            match declaration {
                Decl::ExportSpec(specifier) => {
                    let item = hir[specifier];
                    let statement = hir[item.export];
                    if item.type_only || statement.type_only {
                        continue;
                    }
                    if statement.has_module_specifier {
                        if self.variables_left > 0 {
                            self.variables_left -= 1;
                            let kind = ImportSiteKind::ExportFrom(item.export);
                            let site = files.analysis(exporter).import_site_index(kind);
                            self.follow_export(exporter, site, item.local);
                        }
                    } else if let Binding::Symbol(local) = bound.exported_binding(specifier) {
                        self.follow_symbol(exporter, local);
                    }
                }
                Decl::Var(_) => self.follow_symbol(exporter, bound.declared_symbol(declaration)),
                Decl::ExportExpr(statement) => {
                    if let StmtKind::ExportDefault(value) = hir[statement].kind {
                        self.pending.push((exporter, value));
                    }
                }
                _ => {}
            }
        }
    }
}
