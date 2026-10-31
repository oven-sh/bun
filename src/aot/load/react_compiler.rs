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
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, CodeUnit, ImplicitReference};
use bun_sema::fold::Decision;
use bun_sema::hir::{self, ExprId, FileBuilder};
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

/// An expression in whose place the fold put the path of a define. The compiler reads the file as it is written: it sees the expression, and nothing of the first name of the path.
struct DefineSite {
    position: u32,
    head: Atom,
    /// Code that runs reads `head` from a binding below the top level of the file, or looks the name up when it runs.
    reads_below_top_level: bool,
}

fn is_read_below_top_level(request: &TransformRequest<'_, '_>, head: &ImplicitReference) -> bool {
    let bound = request.bound;
    let is_at_top_level = match head.binding {
        Binding::Symbol(symbol) => {
            bound.symbol_scope(symbol) == bound.top_scope(request.hir, CodeUnit::File)
        }
        Binding::Arguments(unit) => unit == CodeUnit::File,
        Binding::CommonJs(_) => true,
        // A `with` object or evaluated text may declare the name.
        Binding::Free => false,
    };
    !is_at_top_level && request.analysis.decisions.reads_define_head(head)
}

/// A file in which no define puts a name or a path has no site: it pays one test, and no expression of it is looked at.
fn find_define_sites(request: &TransformRequest<'_, '_>) -> Vec<DefineSite> {
    let tree: &hir::File<'_> = request.hir;
    let decisions = &request.analysis.decisions;
    if !decisions.has_define_paths() {
        return Vec::new();
    }
    let expressions = (0..tree.exprs.len() as u32).map(ExprId);
    let sites = expressions.filter_map(|expression| {
        let (head, reads_below_top_level) = match decisions.decision(expression) {
            Decision::GlobalPath(path) => (*path.first()?, false),
            Decision::NamedPath(path) => {
                let head = &path.head;
                (head.name, is_read_below_top_level(request, head))
            }
            Decision::Unknown
            | Decision::Constant(_)
            | Decision::Data(_)
            | Decision::DeferredData => return None,
        };
        Some(DefineSite {
            position: tree[expression].pos,
            head,
            reads_below_top_level,
        })
    });
    sites.collect()
}

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
        let define_sites = find_define_sites(request);
        let mut writer = TreeWriter::new(FileBuilder::from_file(tree), atoms, file_jsx);
        let mut has_compiled_function = false;
        for candidate in &candidates {
            let function = candidate.function.id();
            // A file without a site asks nothing of the function.
            let define_heads: Vec<Atom> = match define_sites.is_empty() {
                true => Vec::new(),
                false => {
                    let span = candidate.function.estree_span();
                    let sites = define_sites.iter();
                    let sites = sites.filter(|site| span.contains_offset(site.position));
                    // The compiler sees no read of such a binding: it may remove the binding, or keep what it made of an earlier value. The function stays as it is written.
                    if sites.clone().any(|site| site.reads_below_top_level) {
                        continue;
                    }
                    sites.map(|site| site.head).collect()
                }
            };
            let written = generate_function(&file, candidate, &options, |generated| {
                writer.replace_function(function, generated, &define_heads)
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
