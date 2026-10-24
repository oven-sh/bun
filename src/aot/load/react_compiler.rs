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
use bun_lint::ast;
use bun_lint::language::LanguageOptions;
use bun_lint_react_compiler::code_generation::{
    GenerationError, GenerationOptions, find_candidates, generate_function,
    has_module_scope_opt_out,
};
use bun_sema::atom::Interner;
use bun_sema::hir::{self, FileBuilder};
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::{JsxRuntime, TransformRequest, TreeChange};
use bun_sema::session::Arena;
use bun_sema_driver::host::to_native;

use self::writer::{TreeWriter, UnsupportedNode};
use crate::diagnostics::LoadMessages;
use crate::load::is_in_node_modules;
use crate::load::sources::{ParsedSource, SourceKind};

pub(crate) const DECLARATIONS_PATH: &[u8] = b"/$bun/react-compiler/runtime.d.ts";
pub(crate) const DECLARATIONS: &[u8] =
    b"declare module \"react/compiler-runtime\" {\n  export function c(size: number): any[];\n}\n";

pub(crate) struct ReactCompiler<'a> {
    mode: ReactCompilerMode,
    messages: &'a LoadMessages,
}

impl<'a> ReactCompiler<'a> {
    pub(crate) fn new(mode: ReactCompilerMode, messages: &'a LoadMessages) -> ReactCompiler<'a> {
        ReactCompiler { mode, messages }
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
        let Some(compiled_tree) = self.compile_components(arena, atoms, request) else {
            return TreeChange::Unchanged;
        };
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
        request: &TransformRequest<'_, 's>,
    ) -> Option<hir::File<'s>> {
        let tree: &hir::File<'s> = request.hir;
        let language = LanguageOptions::default();
        let file = ast::File::new(request.path, tree, request.bound, atoms, &language, None);
        if has_module_scope_opt_out(&file) {
            return None;
        }
        let candidates = find_candidates(&file);
        if candidates.is_empty() {
            return None;
        }
        let jsx = request.settings.jsx.with_pragmas(&tree.jsx_pragmas, atoms);
        let file_jsx = jsx.as_ref().unwrap_or(&request.settings.jsx);
        let options = GenerationOptions {
            is_development: file_jsx.is_development,
            is_server: self.mode.is_ssr(),
            uses_classic_jsx: match file_jsx.runtime {
                JsxRuntime::Classic => true,
                JsxRuntime::Automatic => false,
            },
        };
        let mut writer = TreeWriter::new(FileBuilder::from_file(tree), atoms, file_jsx);
        let mut has_compiled_function = false;
        for candidate in &candidates {
            let function = candidate.function.id();
            let written = generate_function(&file, candidate, &options, |generated| {
                writer.replace_function(function, generated)
            });
            match written {
                Ok(None) => {}
                Ok(Some(Ok(()))) => has_compiled_function = true,
                Ok(Some(Err(UnsupportedNode(name)))) => {
                    self.report_unsupported_node(name, request.path);
                    return None;
                }
                Err(error) => {
                    self.report_generation_error(&error, request.path);
                    return None;
                }
            }
        }
        if !has_compiled_function {
            return None;
        }
        Some(writer.into_file(arena))
    }

    fn report_unsupported_node(&self, name: &str, path: &[u8]) {
        let path = BStr::new(to_native(path));
        let message = format!("React Compiler output has a {name} node in {path}");
        self.messages.report_internal_error(message.into_bytes());
    }

    fn report_generation_error(&self, error: &GenerationError, path: &[u8]) {
        let (text, path) = (&error.text, BStr::new(to_native(path)));
        self.messages.with_log(|log| {
            log.add_error_fmt(
                None,
                Loc::EMPTY,
                format_args!("React Compiler: {text} in \"{path}\""),
            );
        });
    }
}
