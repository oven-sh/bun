pub(super) mod module_items;
#[cfg(test)]
mod tests;
mod write_bindings;
mod write_expressions;
mod write_statements;
mod writer;

use bstr::BStr;
use bun_ast::runtime::ReactCompilerMode;
use bun_ast::{Loader, Loc};
use bun_react_compiler::diagnostics::CompilerError;
use bun_react_compiler::{AddedImport, CompiledFunction, Observer};
use bun_sema::atom::Interner;
use bun_sema::hir::{self, FileBuilder, FnBody, FnId};
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::{JsxSettings, TransformRequest, TreeChange};
use bun_sema::session::Arena;
use bun_sema_driver::host::to_native;

use self::writer::{TreeWriter, UnsupportedNode};
use crate::diagnostics::LoadMessages;
use crate::load::is_in_node_modules;
use crate::load::source_provider::{ComponentFile, ModuleName, SourceProvider};
use crate::load::sources::{ParsedSource, SourceKind};

pub(crate) const DECLARATIONS_PATH: &[u8] = b"/$bun/react-compiler/runtime.d.ts";
pub(crate) const DECLARATIONS: &[u8] =
    b"declare module \"react/compiler-runtime\" {\n  export function c(size: number): any[];\n}\n";

pub(crate) struct ReactCompiler<'a> {
    mode: ReactCompilerMode,
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
            provider,
            messages,
        }
    }

    pub(crate) fn applies_to(&self, path: &[u8], loader: Loader) -> bool {
        self.mode.is_enabled() && loader.is_jsx() && !is_in_node_modules(path)
    }

    pub(crate) fn transform<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut TransformRequest<'_, 's>,
        source: &mut ParsedSource,
    ) -> TreeChange {
        let provider_path = match &source.plugin_module {
            Some(module) => &module.path[..],
            None => to_native(request.path),
        };
        let can_have_import_statements = match request.analysis.module_format {
            ModuleFormat::Esm => true,
            ModuleFormat::CommonJs => false,
        };
        if !self.applies_to(provider_path, source.loader)
            || source.kind != SourceKind::Program
            || !can_have_import_statements
        {
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
        *request.hir = compiled_tree;
        source.has_compiled_components = true;
        TreeChange::Changed
    }

    pub(crate) fn needs_declarations(&self, source: &ParsedSource) -> bool {
        source.has_compiled_components
    }

    /// Runs the compiler inside Bun's parser, on the same AST `bun build` gives it. What the compiler memoizes depends
    /// on the shape of the code, so it depends on every rewrite the parser has done by then: defines, dead code
    /// removal, `--minify-syntax`.
    fn compile_components<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &TransformRequest<'_, 's>,
        module: ModuleName<'_>,
        loader: Loader,
    ) -> Option<hir::File<'s>> {
        let tree: &hir::File<'s> = request.hir;
        if tree.fns.is_empty() {
            return None;
        }
        let jsx = request.settings.jsx.with_pragmas(&tree.jsx_pragmas, atoms);
        let mut output = CompilerOutput {
            tree,
            atoms,
            jsx: jsx.as_ref().unwrap_or(&request.settings.jsx),
            writer: None,
            failure: None,
        };
        let file = ComponentFile {
            module,
            contents: &tree.text,
            loader,
            mode: self.mode,
            settings: request.settings,
            is_entry_point: request.import_meta_main != Some(false),
            can_import_macros: tree.imports.iter().any(|it| it.attributes.is_some()),
        };
        let is_parsed = self.provider.compile_components(&file, &mut output);
        match output.failure {
            Some(Failure::Compiler(text)) => self.report_compiler_error(&text, request.path),
            Some(Failure::Writer(name)) => self.report_unsupported_node(name, request.path),
            None if is_parsed => return Some(output.writer?.into_file(arena)),
            // Lowering reports the file's syntax errors.
            None => {}
        }
        None
    }

    fn report_unsupported_node(&self, name: &str, path: &[u8]) {
        let path = BStr::new(to_native(path));
        let message = format!("React Compiler output has a {name} node in {path}");
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

enum Failure {
    Compiler(String),
    Writer(&'static str),
}

/// Copies each compiled function into the type checker's tree.
struct CompilerOutput<'a, 's> {
    tree: &'a hir::File<'s>,
    atoms: &'a Interner<'s>,
    jsx: &'a JsxSettings,
    /// Created when the first function is compiled: it copies the tree.
    writer: Option<TreeWriter<'a, 's>>,
    failure: Option<Failure>,
}

impl CompilerOutput<'_, '_> {
    /// `parameters_loc`: see `CompiledFunction`. Only whitespace and comments can separate `=>` from the `{` after it,
    /// so the closest anchor at or before the position belongs to the compiled function.
    fn find_function(&self, parameters_loc: Loc) -> Option<FnId> {
        let position = u32::try_from(parameters_loc.start).ok()?;
        let functions = self.tree.fns.iter().enumerate();
        let before = functions.filter(|(_, function)| {
            function.anchor <= position && !matches!(function.body, FnBody::None)
        });
        let (index, _) = before.max_by_key(|(_, function)| function.anchor)?;
        Some(FnId(index as u32))
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
