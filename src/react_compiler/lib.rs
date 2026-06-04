//! Experimental React Compiler integration.
//!
//! Wraps the Rust port of React Compiler (facebook/react#36173, vendored at a
//! pinned commit under `vendor/react-compiler/`) as a source-to-source
//! transform: parse with oxc, run the compiler over the whole program, and
//! print the compiled program back to source text. The bundler feeds the
//! result into Bun's own parser, so downstream bundling is unchanged.
//!
//! The compiler itself decides which functions to memoize (components and
//! hooks, inferred the same way as `babel-plugin-react-compiler` with
//! `compilationMode: "infer"`) and honors `"use no memo"` opt-out directives.

use oxc_ast::ast;
use oxc_ast_visit::Visit;
use react_compiler::entrypoint::plugin_options::{CompilerTarget, PluginOptions};
use react_compiler_hir::environment_config::EnvironmentConfig;

pub struct CompileOptions {
    /// Parse (and emit) JSX syntax.
    pub jsx: bool,
    /// Parse TypeScript syntax.
    pub typescript: bool,
    /// Development mode (adds component names to the fast-refresh metadata
    /// emitted by the compiler; does not gate compilation).
    pub is_dev: bool,
}

/// Compile `source` with React Compiler.
///
/// Returns `Some(compiled)` when the compiler changed the program, and `None`
/// when the input should be used as-is: no React components or hooks found,
/// syntax the vendored AST converter does not support yet, a parse error
/// (Bun's own parser will report it against the original source), or a
/// compiler bailout.
pub fn compile_source(source: &str, path: &str, options: &CompileOptions) -> Option<String> {
    let source_type = oxc_span::SourceType::default()
        .with_module(true)
        .with_jsx(options.jsx)
        .with_typescript(options.typescript);

    let allocator = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(&allocator, source, source_type).parse();
    if parsed.panicked || !parsed.errors.is_empty() {
        return None;
    }

    // The vendored oxc→Babel-AST converter still has `todo!()` arms for a few
    // exotic constructs. Bun builds with `panic = "abort"`, so reaching one
    // would kill the process — scan for them up front and skip the file
    // instead (skipping is always sound: the original source is used).
    if has_unsupported_syntax(&parsed.program) {
        return None;
    }

    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
    if !semantic_ret.errors.is_empty() {
        return None;
    }

    let plugin_options = PluginOptions {
        should_compile: true,
        enable_reanimated: false,
        is_dev: options.is_dev,
        filename: Some(path.to_string()),
        compilation_mode: "infer".to_string(),
        panic_threshold: "none".to_string(),
        target: CompilerTarget::Version("19".to_string()),
        gating: None,
        dynamic_gating: None,
        no_emit: false,
        output_mode: None,
        eslint_suppression_rules: None,
        flow_suppressions: true,
        ignore_use_no_forget: false,
        custom_opt_out_directives: None,
        environment: EnvironmentConfig::default(),
        source_code: None,
        profiling: false,
        debug: false,
    };

    let result = react_compiler_oxc::transform(
        &parsed.program,
        &semantic_ret.semantic,
        source,
        plugin_options,
    );

    let file = result.file?;
    let emit_allocator = oxc_allocator::Allocator::default();
    Some(react_compiler_oxc::emit(
        &file,
        &emit_allocator,
        Some(source),
        &result.rename_plan,
    ))
}

/// Detects syntax the vendored `react_compiler_oxc::convert_ast` cannot
/// convert yet (its `todo!()` arms). Deliberately over-approximates — a false
/// positive only means the file is not compiled.
fn has_unsupported_syntax(program: &ast::Program) -> bool {
    let mut scan = UnsupportedSyntaxScan { found: false };
    scan.visit_program(program);
    scan.found
}

struct UnsupportedSyntaxScan {
    found: bool,
}

impl<'a> Visit<'a> for UnsupportedSyntaxScan {
    fn visit_statement(&mut self, stmt: &ast::Statement<'a>) {
        if self.found {
            return;
        }
        match stmt {
            ast::Statement::TSImportEqualsDeclaration(_)
            | ast::Statement::TSExportAssignment(_)
            | ast::Statement::TSNamespaceExportDeclaration(_)
            | ast::Statement::TSGlobalDeclaration(_) => {
                self.found = true;
            }
            _ => oxc_ast_visit::walk::walk_statement(self, stmt),
        }
    }

    fn visit_export_default_declaration(&mut self, decl: &ast::ExportDefaultDeclaration<'a>) {
        if self.found {
            return;
        }
        if matches!(
            decl.declaration,
            ast::ExportDefaultDeclarationKind::TSInterfaceDeclaration(_)
        ) {
            self.found = true;
            return;
        }
        oxc_ast_visit::walk::walk_export_default_declaration(self, decl);
    }

    fn visit_expression(&mut self, expr: &ast::Expression<'a>) {
        if self.found {
            return;
        }
        if matches!(expr, ast::Expression::PrivateInExpression(_)) {
            self.found = true;
            return;
        }
        oxc_ast_visit::walk::walk_expression(self, expr);
    }

    fn visit_chain_element(&mut self, element: &ast::ChainElement<'a>) {
        if self.found {
            return;
        }
        if matches!(element, ast::ChainElement::TSNonNullExpression(_)) {
            self.found = true;
            return;
        }
        oxc_ast_visit::walk::walk_chain_element(self, element);
    }

    fn visit_assignment_target(&mut self, target: &ast::AssignmentTarget<'a>) {
        if self.found {
            return;
        }
        match target {
            ast::AssignmentTarget::TSAsExpression(_)
            | ast::AssignmentTarget::TSSatisfiesExpression(_)
            | ast::AssignmentTarget::TSNonNullExpression(_)
            | ast::AssignmentTarget::TSTypeAssertion(_) => {
                self.found = true;
            }
            _ => oxc_ast_visit::walk::walk_assignment_target(self, target),
        }
    }

    fn visit_for_statement_left(&mut self, left: &ast::ForStatementLeft<'a>) {
        if self.found {
            return;
        }
        match left {
            ast::ForStatementLeft::TSAsExpression(_)
            | ast::ForStatementLeft::TSSatisfiesExpression(_)
            | ast::ForStatementLeft::TSNonNullExpression(_)
            | ast::ForStatementLeft::TSTypeAssertion(_) => {
                self.found = true;
            }
            _ => oxc_ast_visit::walk::walk_for_statement_left(self, left),
        }
    }
}
