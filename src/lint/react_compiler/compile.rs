//! Runs one function through the compiler.

use crate::EnvOptions;
use crate::convert::{ConvertError, Converted, Recorded, Root, WrappedDefault, convert};
use crate::finding::{Detail, Finding, Suggestion};
use crate::host::LintHost;
use bun_ast::ASTMemoryAllocator;
use bun_core::strings;
use bun_lint::ast::{BinOp, File, Func};
use bun_lint::span::Span;
use bun_react_compiler::diagnostics::{
    CompilerDiagnostic, CompilerDiagnosticDetail, CompilerError, CompilerErrorOrDiagnostic,
    CompilerSuggestion, ErrorCategory, SourceLocation,
};
use bun_react_compiler::hir::ReactFunctionType;
use bun_react_compiler::hir::environment_config::ExhaustiveEffectDepsMode;
use bun_react_compiler::lowering::FunctionNode;
use bun_react_compiler::{Categories, EnvironmentConfig};
use rustc_hash::FxHashSet;

/// Which tool's rules the compiler runs for. Each tool has its own fork of the compiler and compiles different
/// functions.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Flavor {
    /// oxlint's `react/*`
    Oxlint,
    /// eslint-plugin-react-hooks' `react-hooks/*`
    Eslint,
}

/// Per-file state.
pub(crate) struct Compiler<'a> {
    file: &'a File<'a>,
    flavor: Flavor,
    wanted: Categories,
    config: EnvironmentConfig,
    /// Memory for the converted trees and the compiler.
    arena: bun_alloc::Arena,
}

/// oxlint's `react_compiler_plugin_options`, or the plugin's `COMPILER_OPTIONS`. With `has_no_foreign_config` we don't
/// follow the plugin where that would make a rule useless.
fn config_of(flavor: Flavor, has_no_foreign_config: bool) -> EnvironmentConfig {
    let is_oxlint = flavor == Flavor::Oxlint;
    EnvironmentConfig {
        validate_ref_access_during_render: true,
        joined_ref_values_keep_their_place: is_oxlint,
        growth_of_ref_free_structures_is_no_change: is_oxlint,
        ref_typed_properties_are_refs_of_their_own: is_oxlint,
        nullish_test_before_ref_init_is_a_guard: is_oxlint,
        effects_keep_their_place: is_oxlint,
        capturing_a_function_is_not_calling_it: is_oxlint,
        function_declarations_are_initialized_on_entry: is_oxlint,
        jsx_can_be_reordered: false,
        arguments_of_no_alias_methods_escape: false,
        flat_map_and_for_each_have_aliasing_signatures: is_oxlint,
        captured_targets_with_keys_force_temporaries: is_oxlint,
        unreachable_code_is_reported_at_its_function: is_oxlint,
        tagged_templates_are_always_called: is_oxlint,
        react_is_known_by_its_module: false,
        dependencies_are_sorted_by_bytes: is_oxlint,
        callback_dependencies_end_before_current: is_oxlint,
        validate_no_set_state_in_render: true,
        validate_no_set_state_in_effects: true,
        validate_no_jsx_in_try_statements: true,
        validate_no_impure_functions_in_render: true,
        async_components_render_once: is_oxlint,
        validate_static_components: true,
        validate_no_freezing_known_mutable_functions: true,
        validate_no_void_use_memo: true,
        validate_no_capitalized_calls: Some(match is_oxlint || has_no_foreign_config {
            // Globals that oxc's compiler knows and Bun's doesn't.
            true => vec!["BigInt".to_owned(), "Symbol".to_owned()],
            false => Vec::new(),
        }),
        validate_hooks_usage: true,
        validate_no_derived_computations_in_effects: true,
        validate_exhaustive_memoization_dependencies: true,
        // The plugin keeps this behind a flag that's off, so its `exhaustive-effect-dependencies` never reports.
        validate_exhaustive_effect_dependencies: match is_oxlint || has_no_foreign_config {
            true => ExhaustiveEffectDepsMode::All,
            false => ExhaustiveEffectDepsMode::Off,
        },
        // The types are only for what is imported from `react-native-reanimated`.
        enable_custom_type_definition_for_reanimated: is_oxlint,
        ..EnvironmentConfig::default()
    }
}

/// The capitalized functions that `options` allow to be called in the file. The compiler has no regular expressions, so
/// the pattern becomes the names it matches. Those are among the file's references: a function that's called has one.
fn allowed_capitalized_calls<'a>(file: &'a File<'a>, options: &EnvOptions) -> Vec<String> {
    let mut allowed = options.capitalized_calls_allow.clone();
    let Some(pattern) = &options.capitalized_calls_allow_pattern else {
        return allowed;
    };
    let mut seen = FxHashSet::default();
    for name in file.references().map(|it| it.name().bytes()) {
        if name.first().is_some_and(u8::is_ascii_uppercase)
            && seen.insert(name)
            && pattern.test(name)
            && let Ok(name) = std::str::from_utf8(name)
        {
            allowed.push(name.to_owned());
        }
    }
    allowed
}

impl<'a> Compiler<'a> {
    pub(crate) fn new(file: &'a File<'a>, flavor: Flavor, wanted: Categories) -> Compiler<'a> {
        let mut config = config_of(flavor, file.language().has_no_foreign_config);
        if flavor == Flavor::Oxlint
            && let Some(options) = crate::env_options(file)
            && let Some(allowed) = &mut config.validate_no_capitalized_calls
        {
            allowed.extend(allowed_capitalized_calls(file, options));
        }
        Compiler {
            file,
            flavor,
            wanted,
            config,
            arena: bun_alloc::Arena::new(),
        }
    }

    /// oxc's `pipeline::compile_fn::<false>`. `Err` has the failed attempt's diagnostics. Whatever the pipeline logs is
    /// appended to `logged` in both cases.
    pub(crate) fn compile_fn(
        &mut self,
        func: Func<'a>,
        fn_type: ReactFunctionType,
        logged: &mut Vec<Finding>,
    ) -> Result<(), Vec<Finding>> {
        // Nothing from the previous function is still in use. Most functions are small, so a new heap for each would
        // cost more than it's worth.
        let _ = self.arena.reset_retain_with_limit(8 * 1024 * 1024);
        let arena = &self.arena;
        let mut allocator = ASTMemoryAllocator::borrowing(arena);
        let _scope = allocator.enter();
        let converted = match convert(self.file, arena, func, self.flavor) {
            Ok(converted) => converted,
            Err(ConvertError::Using) => return Ok(()),
            Err(ConvertError::ThisParameter) => return Err(Vec::new()),
            Err(ConvertError::TooDeep) => return Err(vec![too_deep()]),
        };
        let host = LintHost::new(&converted, arena, self.file.text());
        let node = match &converted.root {
            Root::Function(function) => FunctionNode::Function(function),
            Root::Arrow(arrow) => FunctionNode::Arrow(arrow),
        };
        let wanted = self.wanted;
        let is_wanted = |it: &Recorded| {
            wanted.has_thrown()
                || wanted.has(match it {
                    Recorded::ImplicitArguments(_) => ErrorCategory::UnsupportedSyntax,
                    Recorded::DuplicateFbtTags { .. }
                    | Recorded::DynamicImport(_)
                    | Recorded::DefaultIsJsx { .. } => ErrorCategory::Todo,
                })
        };
        let linted = bun_react_compiler::lint_function(
            &node,
            &host,
            fn_type,
            &self.config,
            &converted.import_bindings,
            wanted,
            converted.recorded.iter().any(is_wanted),
        );
        logged.extend(findings(&converted, linted.logged));
        let recorded = converted.recorded.iter().map(|it| match *it {
            Recorded::DuplicateFbtTags {
                tag,
                name,
                ref tag_spans,
            } => duplicate_fbt_tags(tag, name, tag_spans),
            Recorded::ImplicitArguments(span) => implicit_arguments(span),
            Recorded::DynamicImport(span) => todo(
                "(BuildHIR::lowerExpression) Handle Import expressions".to_owned(),
                span,
            ),
            Recorded::DefaultIsJsx { span, is_fragment } => {
                let kind = if is_fragment {
                    "JSXFragment"
                } else {
                    "JSXElement"
                };
                todo(
                    format!("{CANNOT_BE_REORDERED}{kind}` cannot be safely reordered"),
                    span,
                )
            }
        });
        // The JSX is a call in the converted tree, and this is the lowering's diagnostic for that call. `recorded`
        // already has the right one.
        let is_already_recorded = |it: &Finding| {
            it.reason.starts_with(CANNOT_BE_REORDERED)
                && converted.recorded.iter().any(|recorded| {
                    matches!(recorded, Recorded::DefaultIsJsx { span, .. }
                        if matches!(it.details.first(), Some(Detail::Error { span: Some(at), .. }) if at == span))
                })
        };
        let file = self.file;
        let lowering_findings = |error| {
            findings(&converted, error)
                .filter(|it| !is_already_recorded(it))
                .map(|it| with_estree_kind(file, it))
        };
        let all: Vec<Finding> = match linted.result {
            Ok(()) if converted.recorded.is_empty() => return Ok(()),
            Ok(()) => recorded.collect(),
            Err(error) if error.is_thrown => lowering_findings(error).collect(),
            Err(error) => recorded.chain(lowering_findings(error)).collect(),
        };
        let wrapped = &converted.wrapped_defaults;
        Err((all.into_iter())
            .map(|it| with_wrapper_span(wrapped, it))
            .collect())
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

const CANNOT_BE_REORDERED: &str = "(BuildHIR::node.lowerReorderableExpression) Expression type `";

/// `a || b` is a `BinaryExpression` in Bun's tree, so that's what the lowering calls it. ESTree has a
/// `LogicalExpression`.
fn with_estree_kind<'a>(file: &'a File<'a>, mut finding: Finding) -> Finding {
    if let Some(rest) = finding.reason.strip_prefix(CANNOT_BE_REORDERED)
        && let Some(rest) = rest.strip_prefix("BinaryExpression")
        && let Some(Detail::Error { span: Some(at), .. }) = finding.details.first()
        && crate::oxlint::find(file, *at, |node| node.as_expr()?.binary_op())
            .is_some_and(|op| matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish))
    {
        finding.reason = format!("{CANNOT_BE_REORDERED}LogicalExpression{rest}");
    }
    finding
}

fn with_wrapper_span(wrapped: &[WrappedDefault], mut finding: Finding) -> Finding {
    if let Some(rest) = finding.reason.strip_prefix(CANNOT_BE_REORDERED)
        && let Some(tick) = strings::index_of_char_usize(rest.as_bytes(), b'`')
        && let Some(rest) = rest.get(tick + 1..)
        && let Some(Detail::Error { span: Some(at), .. }) = finding.details.first_mut()
        && let Some(it) = wrapped.iter().find(|it| it.inner == *at)
    {
        finding.reason = format!("{CANNOT_BE_REORDERED}{}`{rest}", it.kind);
        *at = it.whole;
    }
    finding
}

/// A `CompilerError.throwTodo()` or similar from upstream's lowering.
fn todo(reason: String, span: Span) -> Finding {
    Finding {
        category: ErrorCategory::Todo,
        reason,
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

fn duplicate_fbt_tags(tag: &str, name: &str, tag_spans: &[Span]) -> Finding {
    let detail = |&span: &Span| Detail::Error {
        span: Some(span),
        message: Some(format!("Multiple `<{tag}:{name}>` tags found")),
    };
    Finding {
        category: ErrorCategory::Todo,
        reason: "Support duplicate fbt tags".to_owned(),
        description: Some(format!(
            "Support `<{tag}>` tags with multiple `<{tag}:{name}>` values"
        )),
        details: tag_spans.iter().map(detail).collect(),
        suggestions: Vec::new(),
        is_error_detail: false,
        function_span: None,
    }
}

/// The diagnostic for a function that's nested too deeply for the stack.
fn too_deep() -> Finding {
    // It has no span, so it's reported at the start of the function.
    Finding {
        category: ErrorCategory::Todo,
        reason: "Support functions of this size".to_owned(),
        description: Some("The function body is nested too deeply".to_owned()),
        details: Vec::new(),
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

/// The description, with `Date.now` changed back to `Date` where the source has `new Date()`.
fn description_of(converted: &Converted, it: &CompilerDiagnostic) -> Option<String> {
    let description = it.description.as_deref()?;
    let primary_span = span_of(converted, it.primary_location().copied());
    match description.strip_prefix("`Date.now`") {
        Some(rest)
            if primary_span.is_some_and(|it| converted.clock_reads.binary_search(&it).is_ok()) =>
        {
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
