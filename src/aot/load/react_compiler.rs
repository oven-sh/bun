pub(super) mod module_items;
mod names_bound_again;
#[cfg(test)]
mod tests;
mod write_bindings;
mod write_expressions;
mod write_statements;
mod writer;

use bstr::BStr;
use bun_ast::runtime::ReactCompilerMode;
use bun_ast::{Loader, Loc};
use bun_js_parser::Define;
use bun_react_compiler::diagnostics::CompilerError;
use bun_react_compiler::environment::is_hook_name;
use bun_react_compiler::{AddedImport, CompiledFunction, Observer};
use bun_sema::atom::Interner;
use bun_sema::hir::{self, ExprKind, FileBuilder, FnBody, FnId};
use bun_sema::resolve::{EarlyTransformRequest, JsxSettings, TreeChange};
use bun_sema::session::Arena;
use bun_sema_driver::host::to_native;
use bun_sort_by_number::SortByNumber;

pub(crate) use self::module_items::POSITION;
use self::names_bound_again::find_name_bound_elsewhere;
use self::writer::{TreeWriter, UnsupportedNode};
use crate::diagnostics::LoadMessages;
use crate::load::is_in_node_modules;
use crate::load::source_provider::{ComponentFile, ModuleName, SourceProvider};
use crate::load::sources::{ParsedSource, SourceKind};
use crate::options::PathFilter;

pub(crate) const DECLARATIONS_PATH: &[u8] = b"/$bun/react-compiler/runtime.d.ts";
pub(crate) const DECLARATIONS: &[u8] =
    b"declare module \"react/compiler-runtime\" {\n  export function c(size: number): any[];\n}\n";

pub(crate) struct ReactCompiler<'a> {
    mode: ReactCompilerMode,
    filter: Option<PathFilter>,
    binds_names_again: bool,
    defines_write_hook_names: bool,
    provider: &'a dyn SourceProvider,
    messages: &'a LoadMessages,
}

impl<'a> ReactCompiler<'a> {
    pub(crate) fn new(
        mode: ReactCompilerMode,
        provider: &'a dyn SourceProvider,
        messages: &'a LoadMessages,
    ) -> ReactCompiler<'a> {
        ReactCompiler {
            mode,
            filter: None,
            binds_names_again: cfg!(test),
            defines_write_hook_names: provider.define().is_some_and(writes_hook_name),
            provider,
            messages,
        }
    }

    pub(crate) fn with_filter(self, filter: Option<PathFilter>) -> ReactCompiler<'a> {
        ReactCompiler { filter, ..self }
    }

    pub(crate) fn with_names_bound_again(self, binds_names_again: bool) -> ReactCompiler<'a> {
        ReactCompiler {
            binds_names_again,
            ..self
        }
    }

    pub(crate) fn applies_to(&self, path: &[u8], loader: Loader) -> bool {
        let is_wanted = match self.filter {
            Some(PathFilter(is_compiled)) => loader.is_javascript_like() && is_compiled(path),
            None => loader.is_jsx(),
        };
        self.mode.is_enabled() && is_wanted && !is_in_node_modules(path)
    }

    pub(crate) fn transform<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut EarlyTransformRequest<'_, 's>,
        source: &mut ParsedSource,
    ) -> TreeChange {
        let provider_path = match &source.plugin_module {
            Some(module) => &module.path[..],
            None => to_native(request.path),
        };
        if !self.applies_to(provider_path, source.loader) || source.kind != SourceKind::Program {
            return TreeChange::Unchanged;
        }
        let module = match &source.plugin_module {
            Some(module) => ModuleName {
                namespace: &module.namespace,
                path: &module.path,
            },
            None => ModuleName {
                namespace: b"file",
                path: provider_path,
            },
        };
        let compiled_tree = self.compile_components(arena, atoms, request, module, source.loader);
        let Some(compiled_tree) = compiled_tree else {
            return TreeChange::Unchanged;
        };
        if self.binds_names_again
            && let Some((position, name)) =
                find_name_bound_elsewhere(request.hir, &compiled_tree, atoms, arena)
        {
            let before = &request.hir.text[..position as usize];
            let line = bun_core::strings::count_char(before, b'\n') + 1;
            self.report_name_bound_elsewhere(atoms.bytes(name), line, request.path);
        }
        *request.hir = compiled_tree;
        source.has_compiled_components = true;
        TreeChange::Changed
    }

    pub(crate) fn needs_declarations(&self, source: &ParsedSource) -> bool {
        source.has_compiled_components
    }

    fn compile_components<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &EarlyTransformRequest<'_, 's>,
        module: ModuleName<'_>,
        loader: Loader,
    ) -> Option<hir::File<'s>> {
        let tree: &hir::File<'s> = request.hir;
        if tree.fns.is_empty() {
            return None;
        }
        if !self.defines_write_hook_names && !may_hold_component_or_hook(tree, atoms) {
            return None;
        }
        let jsx = request.settings.jsx.with_pragmas(&tree.jsx_pragmas, atoms);
        let mut output = CompilerOutput {
            tree,
            atoms,
            jsx: jsx.as_ref().unwrap_or(&request.settings.jsx),
            writer: None,
            failure: None,
            functions_by_anchor: Vec::new(),
        };
        let file = ComponentFile {
            module,
            contents: &tree.text,
            loader,
            mode: self.mode,
            settings: request.settings,
            is_entry_point: request.import_meta_main != Some(false),
        };
        let is_parsed = self.provider.compile_components(&file, &mut output);
        match output.failure {
            Some(Failure::Compiler(text)) => self.report_compiler_error(&text, request.path),
            Some(Failure::Writer(name)) => self.report_unsupported_node(name, request.path),
            None if is_parsed => {
                return Some(output.writer?.into_file(arena, request.module_format));
            }
            None => {}
        }
        None
    }

    fn report_unsupported_node(&self, name: &str, path: &[u8]) {
        let path = BStr::new(to_native(path));
        let message = format!("React Compiler output has a {name} node in {path}");
        self.messages.report_internal_error(message.into_bytes());
    }

    fn report_name_bound_elsewhere(&self, name: &[u8], line: usize, path: &[u8]) {
        let (name, path) = (BStr::new(name), BStr::new(to_native(path)));
        let message = format!(
            "React Compiler output binds {name} of line {line} in {path} to another declaration"
        );
        self.messages.report_internal_error(message.into_bytes());
    }

    fn report_compiler_error(&self, text: &str, path: &[u8]) {
        let path = BStr::new(to_native(path));
        self.messages.with_log(|log| {
            log.add_error_fmt(
                None,
                Loc::EMPTY,
                format_args!("React Compiler: {text} in \"{path}\""),
            );
        });
    }
}

fn writes_hook_name(define: &Define) -> bool {
    let of_names = define.identifiers.values();
    let of_paths = define.dots.values().flatten().map(|it| &it.data);
    of_names.chain(of_paths).any(|it| {
        let written = it.original_name.as_deref().unwrap_or_default();
        (0..written.len()).any(|start| is_hook_name(&written[start..]))
    })
}

fn may_hold_component_or_hook(tree: &hir::File<'_>, atoms: &Interner<'_>) -> bool {
    let is_hook = |name| is_hook_name(atoms.bytes(name));
    tree.rare_syntax & hir::rare::DIRECTIVE_IN_FUNCTION != 0
        || tree.import_specs.iter().any(|it| is_hook(it.imported))
        || tree.exprs.iter().any(|it| match it.kind {
            ExprKind::Jsx(_) => true,
            ExprKind::Ident(name) | ExprKind::String(name) | ExprKind::Dot { name, .. } => {
                is_hook(name)
            }
            _ => false,
        })
}

enum Failure {
    Compiler(String),
    Writer(&'static str),
}

struct CompilerOutput<'a, 's> {
    tree: &'a hir::File<'s>,
    atoms: &'a Interner<'s>,
    jsx: &'a JsxSettings,
    writer: Option<TreeWriter<'a, 's>>,
    failure: Option<Failure>,
    functions_by_anchor: Vec<(u32, FnId)>,
}

impl CompilerOutput<'_, '_> {
    fn find_function(&mut self, parameters_loc: Loc) -> Option<FnId> {
        let position = u32::try_from(parameters_loc.start).ok()?;
        if self.functions_by_anchor.is_empty() {
            let functions = self.tree.fns.iter().enumerate();
            let written = functions.filter(|(_, function)| !matches!(function.body, FnBody::None));
            let anchors = written.map(|(index, function)| (function.anchor, FnId(index as u32)));
            self.functions_by_anchor = anchors.collect();
            self.functions_by_anchor.sort_by_u32(|entry| entry.0);
        }
        let functions = &self.functions_by_anchor;
        let behind = functions.partition_point(|entry| entry.0 <= position);
        Some(functions[behind.checked_sub(1)?].1)
    }
}

impl Observer for CompilerOutput<'_, '_> {
    fn function_compiled(&mut self, compiled: &CompiledFunction<'_>) {
        if self.failure.is_some() {
            return;
        }
        let Some(function) = self.find_function(compiled.parameters_loc) else {
            self.failure = Some(Failure::Writer("function at an unknown position"));
            return;
        };
        let writer = self.writer.get_or_insert_with(|| {
            TreeWriter::new(FileBuilder::from_file(self.tree), self.atoms, self.jsx)
        });
        if let Err(UnsupportedNode(name)) = writer.replace_function(function, compiled) {
            self.failure = Some(Failure::Writer(name));
        }
    }

    fn imports_added(&mut self, imports: &[AddedImport<'_>]) {
        if let Some(writer) = &mut self.writer {
            writer.add_imports(imports);
        }
    }

    fn compilation_failed(&mut self, error: &CompilerError) {
        self.failure = Some(Failure::Compiler(error.to_string()));
    }
}
