//! One function through the compiler.

use crate::convert::{Converted, Refusal, Root, convert};
use crate::finding::{Detail, Finding, Suggestion};
use crate::host::LintHost;
use bun_ast::ASTMemoryAllocator;
use bun_lint::ast::{File, Func};
use bun_lint::span::Span;
use bun_react_compiler::EnvironmentConfig;
use bun_react_compiler::diagnostics::{
    CompilerDiagnostic, CompilerDiagnosticDetail, CompilerError, CompilerErrorOrDiagnostic,
    CompilerSuggestion, ErrorCategory, SourceLocation,
};
use bun_react_compiler::hir::ReactFunctionType;
use bun_react_compiler::hir::environment_config::ExhaustiveEffectDepsMode;
use bun_react_compiler::lowering::FunctionNode;

/// How much of the compiler runs.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Depth {
    /// All that can change what is reported in a category other than `Todo` and `Invariant`.
    Validations,
    Everything,
}

/// The state for one file.
pub(crate) struct Compiler<'a> {
    file: &'a File<'a>,
    depth: Depth,
    config: EnvironmentConfig,
}

/// oxlint's `react_compiler_plugin_options`
fn config_of_oxlint() -> EnvironmentConfig {
    EnvironmentConfig {
        validate_ref_access_during_render: true,
        validate_no_set_state_in_render: true,
        validate_no_set_state_in_effects: true,
        validate_no_jsx_in_try_statements: true,
        validate_no_impure_functions_in_render: true,
        validate_static_components: true,
        validate_no_freezing_known_mutable_functions: true,
        validate_no_void_use_memo: true,
        // Globals that oxc's compiler knows and Bun's does not.
        validate_no_capitalized_calls: Some(vec!["BigInt".to_owned(), "Symbol".to_owned()]),
        validate_hooks_usage: true,
        validate_no_derived_computations_in_effects: true,
        validate_exhaustive_memoization_dependencies: true,
        validate_exhaustive_effect_dependencies: ExhaustiveEffectDepsMode::All,
        ..EnvironmentConfig::default()
    }
}

impl<'a> Compiler<'a> {
    pub(crate) fn new(file: &'a File<'a>, depth: Depth) -> Compiler<'a> {
        Compiler {
            file,
            depth,
            config: config_of_oxlint(),
        }
    }

    /// oxc's `pipeline::compile_fn::<false>`. `Err`: the diagnostics of the failed attempt. What the
    /// pipeline logs is appended to `logged` in both cases.
    pub(crate) fn compile_fn(
        &mut self,
        func: Func<'a>,
        fn_type: ReactFunctionType,
        logged: &mut Vec<Finding>,
    ) -> Result<(), Vec<Finding>> {
        // All that the tree and the compiler allocate for the function is freed with these.
        let arena = bun_alloc::Arena::new();
        let mut allocator = ASTMemoryAllocator::borrowing(&arena);
        let _scope = allocator.enter();
        let converted = match convert(self.file, &arena, func) {
            Ok(converted) => converted,
            Err(Refusal::Using) => return Ok(()),
            Err(refusal) => return Err(vec![refused(refusal, func.estree_span())]),
        };
        let host = LintHost::new(&converted, &arena, self.file.text());
        let node = match &converted.root {
            Root::Function(function) => FunctionNode::Function(function),
            Root::Arrow(arrow) => FunctionNode::Arrow(arrow),
        };
        let linted = bun_react_compiler::lint_function(
            &node,
            &host,
            fn_type,
            &self.config,
            &converted.import_bindings,
            // An error that a late pass throws drops what is recorded, which these are.
            self.depth == Depth::Everything || !converted.implicit_arguments.is_empty(),
        );
        logged.extend(findings(&converted, linted.logged));
        let recorded = converted
            .implicit_arguments
            .iter()
            .map(|it| implicit_arguments(*it));
        match linted.result {
            Ok(()) if converted.implicit_arguments.is_empty() => Ok(()),
            Ok(()) => Err(recorded.collect()),
            Err(error) if error.is_thrown => Err(findings(&converted, error).collect()),
            Err(error) => Err(recorded.chain(findings(&converted, error)).collect()),
        }
    }
}

/// oxc's `unsupported_implicit_arguments`
fn implicit_arguments(span: Span) -> Finding {
    Finding {
        category: ErrorCategory::UnsupportedSyntax,
        reason: "Implicit 'arguments' is not supported".to_owned(),
        description: Some(
            "React Compiler does not support compiling functions that reference the implicit arguments object"
                .to_owned(),
        ),
        details: vec![Detail::Error {
            span: Some(span),
            message: Some("Implicit 'arguments' is not supported".to_owned()),
        }],
        suggestions: Vec::new(),
        is_error_detail: false,
        function_span: None,
    }
}

fn refused(refusal: Refusal, span: Span) -> Finding {
    let reason = match refusal {
        Refusal::TooDeep => "Support functions that are nested this deeply",
        Refusal::TooLarge | Refusal::Using => "Support functions of this size",
    };
    Finding {
        category: ErrorCategory::Todo,
        reason: reason.to_owned(),
        description: None,
        details: vec![Detail::Error {
            span: Some(span),
            message: None,
        }],
        suggestions: Vec::new(),
        is_error_detail: true,
        function_span: None,
    }
}

fn span_of(converted: &Converted, loc: Option<SourceLocation>) -> Option<Span> {
    let loc = loc?;
    let start = converted.span_of(loc.start.index?)?;
    let end = converted.span_of(loc.end.index?)?;
    Some(Span::new(start.start, end.end.max(start.start)))
}

fn suggestions(converted: &Converted, all: Option<Vec<CompilerSuggestion>>) -> Vec<Suggestion> {
    let converted = |it: CompilerSuggestion| {
        let start = converted.span_of(u32::try_from(it.range.0).ok()?)?;
        let end = converted.span_of(u32::try_from(it.range.1).ok()?)?;
        Some(Suggestion {
            op: it.op,
            range: Span::new(start.start, end.end.max(start.start)),
            description: it.description,
            text: it.text,
        })
    };
    all.into_iter().flatten().filter_map(converted).collect()
}

/// What the compiler says of `Date.now()` where the source has `new Date()`.
fn description_of(converted: &Converted, it: &CompilerDiagnostic) -> Option<String> {
    let description = it.description.as_deref()?;
    let place = span_of(converted, it.primary_location().copied());
    match description.strip_prefix("`Date.now`") {
        Some(rest) if place.is_some_and(|it| converted.clock_reads.binary_search(&it).is_ok()) => {
            Some(format!("`Date`{rest}"))
        }
        _ => Some(description.to_owned()),
    }
}

fn findings(converted: &Converted, error: CompilerError) -> impl Iterator<Item = Finding> + '_ {
    error.details.into_iter().map(move |it| match it {
        CompilerErrorOrDiagnostic::Diagnostic(it) => Finding {
            category: it.category,
            description: description_of(converted, &it),
            reason: it.reason,
            details: (it.details.into_iter())
                .map(|detail| match detail {
                    CompilerDiagnosticDetail::Error { loc, message, .. } => Detail::Error {
                        span: span_of(converted, loc),
                        message,
                    },
                    CompilerDiagnosticDetail::Hint { message } => Detail::Hint { message },
                })
                .collect(),
            suggestions: suggestions(converted, it.suggestions),
            is_error_detail: false,
            function_span: None,
        },
        CompilerErrorOrDiagnostic::ErrorDetail(it) => Finding {
            category: it.category,
            reason: it.reason,
            description: it.description,
            details: vec![Detail::Error {
                span: span_of(converted, it.loc),
                message: None,
            }],
            suggestions: suggestions(converted, it.suggestions),
            is_error_detail: true,
            function_span: None,
        },
    })
}
