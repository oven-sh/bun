//! What oxlint 1.87 prints for a diagnostic of the compiler.
//!
//! oxc has a fork of the compiler whose diagnostics are the functions of its `diagnostics.rs`. They differ from the compiler's in
//! three ways:
//! - The texts. A link is never part of a text. Many are written anew.
//! - The places. A function is marked up to its `{`, a call at what is called, an element of JSX at its name.
//! - More places: where the variable is declared, which function is the nested one, which effect it is in.
//!
//! [`render`] applies the rules that hold for all of them first, which are those of oxc's `diagnostic()`, `with_fallback_label()`
//! and `run_react_compiler_rule()`. Then come the exceptions, one function for each category, in which a diagnostic is known by
//! its reason. The name of oxc's function is at each. What oxc takes from its HIR is taken from the syntax and the scopes here.
//! [`render_all`] leaves out what oxc says only once.

use crate::finding::{Detail, Finding};
use bun_core::strings;
use bun_lint::ast::{Call, Expr, ExprKind, File, Func, Node, Param, StmtKind};
use bun_lint::semantic::Declaration;
use bun_lint::span::Span;
use bun_lint::utils::get_node_by_range_index;
use bun_react_compiler::diagnostics::ErrorCategory;
use rustc_hash::FxHashSet;
use std::borrow::Cow;
use std::fmt::Write;

pub(crate) type Text = Cow<'static, str>;

pub struct Label {
    pub span: Span,
    /// Empty if the place is marked and nothing is said about it.
    pub text: Text,
}

pub struct Rendered {
    pub message: Text,
    pub help: Text,
    pub note: Text,
    /// In the order of `-f json`. The first is the primary one in every diagnostic of oxc.
    pub labels: Vec<Label>,
}

impl Rendered {
    fn say(&mut self, message: &'static str, help: &'static str) {
        self.message = Cow::Borrowed(message);
        self.help = Cow::Borrowed(help);
    }

    /// Where the first label is.
    fn place(&self) -> Option<Span> {
        self.labels.first().map(|label| label.span)
    }

    /// What the first label says.
    fn text(&self) -> &str {
        self.labels.first().map_or("", |label| &*label.text)
    }

    /// The first label says `text`.
    fn relabel(&mut self, text: impl Into<Text>) {
        if let Some(first) = self.labels.first_mut() {
            first.text = text.into();
        }
    }

    /// The first label is at `span`, if that is known.
    fn move_to(&mut self, span: Option<Span>) {
        if let (Some(first), Some(span)) = (self.labels.first_mut(), span) {
            first.span = span;
        }
    }

    /// One more label, unless it would be where the first is.
    fn also(&mut self, span: Option<Span>, text: impl Into<Text>) {
        if let Some(span) = span
            && self.place() != Some(span)
        {
            self.push(span, text);
        }
    }

    fn push(&mut self, span: Span, text: impl Into<Text>) {
        self.labels.push(Label {
            span,
            text: text.into(),
        });
    }
}

macro_rules! react_lint_url {
    ($rule:literal) => {
        concat!(
            "https://react.dev/reference/eslint-plugin-react-hooks/lints/",
            $rule
        )
    };
}

/// oxc's `ErrorCategory::documentation_url`
const fn documentation_url(category: ErrorCategory) -> &'static str {
    match category {
        ErrorCategory::Hooks => react_lint_url!("rules-of-hooks"),
        ErrorCategory::CapitalizedCalls | ErrorCategory::StaticComponents => {
            react_lint_url!("static-components")
        }
        ErrorCategory::UseMemo | ErrorCategory::VoidUseMemo => react_lint_url!("use-memo"),
        ErrorCategory::PreserveManualMemo => react_lint_url!("preserve-manual-memoization"),
        ErrorCategory::MemoDependencies | ErrorCategory::EffectExhaustiveDependencies => {
            react_lint_url!("exhaustive-deps")
        }
        ErrorCategory::IncompatibleLibrary => react_lint_url!("incompatible-library"),
        ErrorCategory::Immutability => react_lint_url!("immutability"),
        ErrorCategory::Globals => react_lint_url!("globals"),
        ErrorCategory::Refs => react_lint_url!("refs"),
        ErrorCategory::EffectSetState | ErrorCategory::EffectDerivationsOfState => {
            react_lint_url!("set-state-in-effect")
        }
        ErrorCategory::ErrorBoundaries => react_lint_url!("error-boundaries"),
        ErrorCategory::Purity => react_lint_url!("purity"),
        ErrorCategory::RenderSetState => react_lint_url!("set-state-in-render"),
        ErrorCategory::Config => react_lint_url!("config"),
        ErrorCategory::Gating => react_lint_url!("gating"),
        ErrorCategory::Syntax | ErrorCategory::UnsupportedSyntax | ErrorCategory::Todo => {
            react_lint_url!("unsupported-syntax")
        }
        ErrorCategory::Invariant => "https://github.com/oxc-project/oxc/issues/new/choose",
        // oxc does not have the last two.
        ErrorCategory::Suppression | ErrorCategory::EffectDependencies | ErrorCategory::FBT => {
            "https://react.dev/reference/eslint-plugin-react-hooks"
        }
    }
}

/// oxc's `ErrorCategory::default_help`
const fn default_help(category: ErrorCategory) -> &'static str {
    match category {
        ErrorCategory::Invariant => {
            "Please report this internal React Compiler error to Oxc with a minimal reproduction"
        }
        ErrorCategory::Config | ErrorCategory::Gating => {
            "Update the React Compiler configuration and try again"
        }
        ErrorCategory::Todo | ErrorCategory::UnsupportedSyntax | ErrorCategory::Syntax => {
            "Rewrite the highlighted code using syntax supported by React Compiler"
        }
        ErrorCategory::Suppression => {
            "Remove the suppression and address the reported React rule violation"
        }
        _ => "Rewrite the highlighted code to follow the Rules of React",
    }
}

/// oxc's `ErrorCategory::default_note`
const fn default_note(category: ErrorCategory) -> &'static str {
    match category {
        ErrorCategory::Invariant => {
            "This is an internal React Compiler error; the component or hook was not optimized"
        }
        ErrorCategory::Config | ErrorCategory::Gating => {
            "React Compiler could not continue with this configuration"
        }
        _ => "React Compiler skipped optimizing this component or hook",
    }
}

const LOCAL_FBT: &str = "Support local variables named `fbt`";

/// What oxlint prints for `findings`, in their order, each with what it is made of.
pub fn render_all<'a, 'f>(
    file: &'a File<'a>,
    findings: impl IntoIterator<Item = &'f Finding>,
) -> impl Iterator<Item = (&'f Finding, Rendered)> {
    let mut said = FxHashSet::default();
    findings.into_iter().filter_map(move |finding| {
        let rendered = render(file, finding);
        let labels = || {
            rendered
                .labels
                .iter()
                .map(|label| (label.span, label.text.clone()))
        };
        let is_new = !is_said_once(finding) || said.insert(labels().collect::<Vec<_>>());
        is_new.then_some((finding, rendered))
    })
}

/// The compiler says these each time it comes by. oxc's `validate_no_ref_access_in_render` drops a diagnostic that is equal to an
/// earlier one (`DiagnosticKey`), and its `resolve_binding_with_span` complains about a binding the first time it resolves it.
fn is_said_once(finding: &Finding) -> bool {
    finding.category == ErrorCategory::Refs || finding.reason == LOCAL_FBT
}

fn render<'a>(file: &'a File<'a>, finding: &Finding) -> Rendered {
    let category = finding.category;
    // oxc's `diagnostic()`. What the compiler calls a hint is left out.
    let mut out = Rendered {
        message: Cow::Owned(finding.reason.clone()),
        help: match &finding.description {
            Some(description) => Cow::Owned(description.clone()),
            None => Cow::Borrowed(default_help(category)),
        },
        note: Cow::Borrowed(default_note(category)),
        labels: labels_of(finding),
    };
    match category {
        ErrorCategory::Hooks => hooks(file, finding, &mut out),
        ErrorCategory::CapitalizedCalls => capitalized_calls(file, finding, &mut out),
        ErrorCategory::StaticComponents => static_components(file, &mut out),
        ErrorCategory::UseMemo => use_memo(file, finding, &mut out),
        ErrorCategory::VoidUseMemo => void_use_memo(file, finding, &mut out),
        ErrorCategory::PreserveManualMemo => preserve_manual_memo(file, &mut out),
        ErrorCategory::MemoDependencies | ErrorCategory::EffectExhaustiveDependencies => {
            exhaustive_dependencies(finding, &mut out);
        }
        ErrorCategory::Immutability => immutability(file, finding, &mut out),
        ErrorCategory::Globals => globals(&mut out),
        ErrorCategory::Refs => refs(file, &mut out),
        ErrorCategory::EffectSetState => set_state_in_effect(file, &mut out),
        ErrorCategory::EffectDerivationsOfState => derived_state_in_effect(file, &mut out),
        ErrorCategory::ErrorBoundaries => jsx_in_try(file, &mut out),
        ErrorCategory::Purity => purity(finding, &mut out),
        ErrorCategory::RenderSetState => set_state_in_render(finding, &mut out),
        ErrorCategory::Invariant => invariant(finding, &mut out),
        ErrorCategory::Todo => todo(file, finding, &mut out),
        ErrorCategory::Syntax => syntax(file, finding, &mut out),
        ErrorCategory::UnsupportedSyntax => unsupported_syntax(finding, &mut out),
        ErrorCategory::Suppression => suppression(finding, &mut out),
        ErrorCategory::IncompatibleLibrary
        | ErrorCategory::Config
        | ErrorCategory::Gating
        | ErrorCategory::EffectDependencies
        | ErrorCategory::FBT => {}
    }
    // oxc's `with_fallback_label`
    if out.labels.is_empty()
        && let Some(span) = finding.function_span
    {
        let text = out.message.clone();
        out.push(span, text);
    }
    // oxlint's `run_react_compiler_rule`
    out.note = Cow::Owned(format!(
        "{}. Additional guidance: {}",
        out.note,
        documentation_url(category)
    ));
    out
}

fn labels_of(finding: &Finding) -> Vec<Label> {
    let text_of = |message: Option<&str>| match message {
        Some(message) => Cow::Owned(message.to_owned()),
        // The compiler's `invariant()` repeats the reason where it has nothing else to say.
        None if finding.category == ErrorCategory::Invariant && !finding.is_error_detail => {
            Cow::Owned(finding.reason.clone())
        }
        None => Cow::Borrowed(""),
    };
    let labels = finding.details.iter().filter_map(|detail| match detail {
        Detail::Error {
            span: Some(span),
            message,
        } => Some(Label {
            span: *span,
            text: text_of(message.as_deref()),
        }),
        Detail::Error { span: None, .. } | Detail::Hint { .. } => None,
    });
    labels.collect()
}

// ───────────────────────────── from a place to the syntax ─────────────────────────────

/// What `pick` makes of a node that is written exactly at `span`, the innermost first.
fn find<'a, T>(file: &'a File<'a>, span: Span, pick: impl Fn(Node<'a>) -> Option<T>) -> Option<T> {
    let innermost = get_node_by_range_index(file, span.start);
    std::iter::once(innermost)
        .chain(innermost.ancestors())
        .take_while(|node| span.contains(node.span()))
        .filter(|node| node.span() == span)
        .find_map(pick)
}

fn function_at<'a>(file: &'a File<'a>, span: Span) -> Option<Func<'a>> {
    find(file, span, Node::as_func)
}

/// The innermost function around what is written at `span`.
fn enclosing_function<'a>(file: &'a File<'a>, span: Span) -> Option<Func<'a>> {
    get_node_by_range_index(file, span.start).enclosing_function()
}

/// The parameter that `span` is, or is the start of.
fn parameter_at<'a>(file: &'a File<'a>, span: Span) -> Option<Param<'a>> {
    let innermost = get_node_by_range_index(file, span.start);
    std::iter::once(innermost)
        .chain(innermost.ancestors())
        .take_while(|node| !matches!(node, Node::Func(_)))
        .find_map(|node| match node {
            Node::Param(param) => Some(param),
            _ => None,
        })
}

/// The property of a pattern or of an object literal that `span` is in.
fn property_around<'a>(file: &'a File<'a>, span: Span) -> Option<Span> {
    let innermost = get_node_by_range_index(file, span.start);
    std::iter::once(innermost)
        .chain(innermost.ancestors())
        .find_map(|node| match node {
            Node::PatProp(property) => Some(property.span()),
            Node::Prop(property) => Some(property.span()),
            _ => None,
        })
}

/// Where the variable that is read or written at `span` is declared: the `span` of a named `Identifier` of oxc's HIR.
fn declaration_of<'a>(file: &'a File<'a>, span: Span) -> Option<Span> {
    let reference = file
        .reference_at(span.start)
        .filter(|it| it.span() == span)?;
    reference.symbol()?.declarations().next()?.name_span()
}

/// The first `len` bytes of `span`.
fn start_of(span: Span, len: u32) -> Span {
    Span::new(span.start, span.start.saturating_add(len).min(span.end))
}

/// Where oxc's HIR has a parameter. It has a pattern and a parameter with a default nowhere.
fn place_of_parameter(param: Param) -> Option<Span> {
    if param.is_rest() {
        return Some(param.span());
    }
    let pat = param.pat();
    (param.default().is_none() && pat.as_ident().is_some()).then(|| pat.span())
}

/// oxc's `HirFunction::diagnostic_span`: up to the `{`. Of an arrow function without one it is `async`, or up to the first
/// parameter, or two bytes.
fn function_head(func: Func) -> Span {
    let whole = func.span();
    let end = match func.body_span() {
        Some(body) => body.start.saturating_add(1),
        None if func.is_async() => whole.start.saturating_add(5),
        None => match func.params().first().and_then(place_of_parameter) {
            Some(first) => first.end,
            None => whole.start.saturating_add(2),
        },
    };
    Span::new(whole.start, end.min(whole.end))
}

/// The function that the value at `span` is: it is written there, or the name of a function declaration is, or of a variable that
/// is declared with a function. oxc follows the loads and the stores of its HIR, also those of a later assignment.
fn function_of_value<'a>(file: &'a File<'a>, span: Span) -> Option<Func<'a>> {
    let Some(reference) = file.reference_at(span.start).filter(|it| it.span() == span) else {
        return function_at(file, span);
    };
    match reference.symbol()?.declarations().next()? {
        Declaration::Fn(func) => Some(func),
        Declaration::Var(pat) => match pat.parent() {
            Node::VarDecl(declaration) => declaration.init()?.as_fn(),
            _ => None,
        },
        _ => None,
    }
}

/// Where the name of what `callee` calls is written.
fn called_name(callee: Expr) -> Span {
    match callee.kind() {
        ExprKind::Dot { name, .. } => name.span(),
        ExprKind::Index { index, .. } => index.span(),
        _ => callee.span(),
    }
}

/// The call that has the function `func` as its first argument.
fn call_with_callback(func: Func) -> Option<Call> {
    let callback = func.owner().as_expr()?;
    let call = callback.parent().as_expr()?.as_call()?;
    (call.args().first() == Some(callback)).then_some(call)
}

/// The call of `useEffect` and the like in whose callback `span` is, not in a function in it.
fn effect_around<'a>(file: &'a File<'a>, span: Span) -> Option<Call<'a>> {
    let call = call_with_callback(enclosing_function(file, span)?)?;
    let name = match call.callee().kind() {
        ExprKind::Ident(name) => name,
        ExprKind::Dot { name, .. } => name.name(),
        _ => return None,
    };
    name.is_any(&["useEffect", "useLayoutEffect", "useInsertionEffect"])
        .then_some(call)
}

/// The call of `useMemo` or `useCallback` that is written at `span`, or whose callback is.
fn memo_call_at<'a>(file: &'a File<'a>, span: Span) -> Option<Call<'a>> {
    find(file, span, |node| match node {
        Node::Func(func) => call_with_callback(func),
        Node::Expr(e) => e.as_call(),
        _ => None,
    })
}

/// The first label marks the head of the function that it is at.
fn narrow_to_function_head<'a>(file: &'a File<'a>, out: &mut Rendered) {
    let head = out.place().and_then(|at| function_at(file, at));
    out.move_to(head.map(function_head));
}

// ───────────────────────────── the exceptions ─────────────────────────────

fn hooks<'a>(file: &'a File<'a>, finding: &Finding, out: &mut Rendered) {
    let reason = finding.reason.as_str();
    if reason.starts_with("Hooks must always be called in a consistent order") {
        // `conditional_hook`
        out.say(
            "Hooks must always be called in a consistent order and may not be called conditionally",
            "Call Hooks unconditionally at the top level of the component or custom Hook",
        );
        out.relabel("This Hook is called conditionally");
    } else if reason.starts_with("Hooks may not be referenced as normal values") {
        // `hook_used_as_value`
        out.say(
            "Hooks may not be referenced as normal values; they must be called",
            "Call the Hook directly instead of passing or storing it as a value",
        );
        out.relabel("This Hook is used as a value");
    } else if reason.starts_with("Hooks must be the same function on every render") {
        // `dynamic_hook`. What is called by a name originates where the name is declared, anything else where it is written.
        out.say(
            "Hooks must be the same function on every render, but this value may change over time",
            "Call a statically known Hook instead of selecting a Hook dynamically",
        );
        out.relabel("This Hook may change between renders");
        let origin = out.place().and_then(|at| declaration_of(file, at));
        out.also(origin, "This dynamic Hook value originates here");
    } else if reason.starts_with("Hooks must be called at the top level") {
        // `hook_in_function_expression`
        out.message = Cow::Borrowed(
            "Hooks must be called at the top level of a function component or custom Hook",
        );
        out.relabel("This Hook is called inside a nested function");
        let nested = out.place().and_then(|at| enclosing_function(file, at));
        out.also(nested.map(function_head), "This is the nested function");
    }
}

/// `capitalized_call`
fn capitalized_calls<'a>(file: &'a File<'a>, finding: &Finding, out: &mut Rendered) {
    let description = finding.description.as_deref().unwrap_or_default();
    let name = description
        .strip_suffix(" may be a component")
        .unwrap_or(description);
    out.message = Cow::Borrowed("Capitalized function called without JSX");
    out.help = Cow::Owned(format!(
        "Render `{name}` with JSX if it is a component; otherwise rename it to start with a lowercase letter or allowlist it \
         in the compiler configuration"
    ));
    out.note = Cow::Owned(format!(
        "`{name}` is treated as a component because it begins with an uppercase letter; React Compiler skipped optimizing \
         this component or hook"
    ));
    out.relabel(format!("`{name}` may be a component"));
    let callee = out
        .place()
        .and_then(|at| find(file, at, |node| node.as_expr()?.callee()));
    out.move_to(callee.map(called_name));
}

/// `static_component_during_render`
fn static_components<'a>(file: &'a File<'a>, out: &mut Rendered) {
    let Some(creation) = out.labels.get_mut(1) else {
        return;
    };
    let narrower = find(file, creation.span, |node| match node {
        Node::Func(func) => Some(function_head(func)),
        Node::Expr(e) => Some(e.callee()?.span()),
        _ => None,
    });
    creation.span = narrower.unwrap_or(creation.span);
}

fn use_memo<'a>(file: &'a File<'a>, finding: &Finding, out: &mut Rendered) {
    let reason = finding.reason.as_str();
    match reason {
        // `expected_inline_memo_function`
        "Expected the first argument to be an inline function expression" => {
            out.help = Cow::Borrowed("Pass an inline function expression as the first argument");
        }
        // `expected_simple_memo_dependencies`
        "Expected the dependency list to be an array of simple expressions (e.g. `x`, `x.y.z`, `x?.y?.z`)" =>
        {
            out.help = Cow::Borrowed(
                "Use an array literal containing identifiers or property access expressions",
            );
        }
        // `use_memo_callback_parameters`
        "useMemo() callbacks may not accept parameters" => {
            if let Some(param) = out.place().and_then(|at| parameter_at(file, at)) {
                match place_of_parameter(param) {
                    Some(span) => out.move_to(Some(span)),
                    None => out.labels.clear(),
                }
            }
        }
        // `async_or_generator_use_memo`
        "useMemo() callbacks may not be async or generator functions" => {
            narrow_to_function_head(file, out)
        }
        // `use_memo_reassigns_outer_variable`
        "useMemo() callbacks may not reassign variables declared outside of the callback" => {
            let origin = out.place().and_then(|at| declaration_of(file, at));
            out.also(
                origin,
                "This variable is captured from outside the callback",
            );
        }
        _ => {
            // `expected_memo_dependency_array`
            let hook = reason.strip_prefix("Expected the dependency list for ");
            if let Some(hook) = hook.and_then(|it| it.strip_suffix(" to be an array literal")) {
                out.help = Cow::Owned(format!(
                    "Pass an array literal as the dependency list for {hook}"
                ));
            }
        }
    }
}

fn void_use_memo<'a>(file: &'a File<'a>, finding: &Finding, out: &mut Rendered) {
    // `use_memo_no_return`
    if finding.reason == "useMemo() callbacks must return a value" {
        narrow_to_function_head(file, out);
    }
}

fn preserve_manual_memo<'a>(file: &'a File<'a>, out: &mut Rendered) {
    let call = out.place().and_then(|at| memo_call_at(file, at));
    match out.text() {
        // `preserve_memo_unmemoized`
        "Could not preserve existing memoization" => {
            out.help = Cow::Borrowed(
                "React Compiler could not prove that this useMemo/useCallback remains memoized. Fix related React Compiler \
                 errors inside the callback first. If manual memoization is not required for semantics, remove it; \
                 otherwise restructure the callback to avoid values that invalidate memoization",
            );
            out.relabel("Manual memoization is not preserved here");
            let Some(call) = call else {
                return;
            };
            let callee = call.callee().span();
            out.move_to(Some(callee));
            if let Some(callback) = call.args().first().map(|it| start_of(it.span(), 1))
                && (callback.end <= callee.start || callback.start >= callee.end)
            {
                out.push(callback, "Manual memoization callback starts here");
            }
        }
        // `preserve_memo_inferred_dependencies`. Where the dependency is inferred, which is a second label, only the compiler
        // knows.
        "Could not preserve existing manual memoization" => {
            if let Some(dependencies) = call.and_then(|call| call.args().get(1)) {
                out.move_to(Some(dependencies.span()));
                out.relabel("This dependency list does not match the dependencies inferred from the callback");
            }
        }
        _ => {}
    }
}

/// What oxc's `validate_dependencies` adds to `exhaustive_dependencies`. The list is what the compiler suggests to replace.
fn exhaustive_dependencies(finding: &Finding, out: &mut Rendered) {
    if matches!(
        finding.reason.as_str(),
        "Found missing memoization dependencies" | "Found missing effect dependencies"
    ) && let Some(suggestion) = finding.suggestions.first()
    {
        out.labels.insert(
            0,
            Label {
                span: suggestion.range,
                text: Cow::Borrowed("This dependency list is missing values used by the callback"),
            },
        );
    }
}

fn immutability<'a>(file: &'a File<'a>, finding: &Finding, out: &mut Rendered) {
    match finding.reason.as_str() {
        // `immutable_value`. What has no name is a temporary, which originates where it is modified.
        "This value cannot be modified" => {
            if out.help
                == "Modifying component props or hook arguments is not allowed. Consider using a local variable instead"
            {
                out.help = Cow::Borrowed(
                    "Do not mutate component props or hook arguments. If the value should change, update it where it is \
                     owned and pass an update callback, or use local state",
                );
            }
            if let Some(variable) = out.text().strip_suffix(" cannot be modified")
                && variable.starts_with('`')
            {
                let text = format!("{variable} originates here");
                let origin = out.place().and_then(|at| declaration_of(file, at));
                out.also(origin, text);
            }
        }
        // `variable_accessed_before_declaration`, which is not told where the variable is declared.
        "Cannot access variable before it is declared" => {
            let description = finding.description.as_deref().unwrap_or_default();
            let variable = (strings::index_of(
                description.as_bytes(),
                b" is accessed before it is declared",
            ))
            .and_then(|end| description.get(..end))
            .filter(|it| it.starts_with('`'));
            out.message = Cow::Borrowed("Cannot access variable while it is being initialized");
            out.help = Cow::Owned(format!(
                "{} is read while its declaration is still being initialized. Move the access after initialization. For a \
                 recursive callback, use a named function expression or restructure the callback so it does not capture \
                 itself during initialization",
                variable.unwrap_or("This variable")
            ));
            out.labels
                .retain(|label| label.text.ends_with(" accessed before it is declared"));
            out.relabel(format!(
                "{} is read during its own initialization",
                variable.unwrap_or("variable")
            ));
        }
        // `reassigned_after_render`
        "Cannot reassign variable after render completes" => {
            let variable = out.text().strip_prefix("Cannot reassign ");
            let variable = variable.and_then(|it| it.strip_suffix(" after render completes"));
            let text = variable.map(|it| format!("{it} is declared here"));
            declared_here(file, text, out);
        }
        // `reassigned_in_async_function`
        "Cannot reassign variable in async function" => {
            let variable = out.text().strip_prefix("Cannot reassign ");
            let text = variable.map(|it| format!("{it} is declared here"));
            declared_here(file, text, out);
        }
        "Cannot modify local variables after render completes" => known_mutable_function(file, out),
        _ => {}
    }
}

fn declared_here<'a>(file: &'a File<'a>, text: Option<String>, out: &mut Rendered) {
    if let Some(text) = text {
        let declaration = out.place().and_then(|at| declaration_of(file, at));
        out.also(declaration, text);
    }
}

/// `known_mutable_function`: what is modified comes first. The function is left out if its label would be around that.
fn known_mutable_function<'a>(file: &'a File<'a>, out: &mut Rendered) {
    let (modified, functions): (Vec<Label>, Vec<Label>) = std::mem::take(&mut out.labels)
        .into_iter()
        .partition(|label| label.text.starts_with("This modifies "));
    out.labels = modified;
    let modified = out.place();
    for mut function in functions {
        if let Some(func) = function_of_value(file, function.span) {
            function.span = function_head(func);
        }
        if modified.is_none_or(|modified| !function.span.contains(modified)) {
            out.labels.push(function);
        }
    }
}

/// `global_reassignment`
fn globals(out: &mut Rendered) {
    if let Some(variable) = out.text().strip_suffix(" cannot be reassigned") {
        out.help = Cow::Owned(format!(
            "Variable {variable} is declared outside of the component/hook. Reassigning this value during render is a side \
             effect which can cause unpredictable behavior. If this variable is used in rendering, use useState instead. \
             Otherwise, update it in an effect"
        ));
    }
}

/// `ref_access` and what calls it. Where a function that is called accesses a ref, which is a second label, only the compiler
/// knows.
fn refs<'a>(file: &'a File<'a>, out: &mut Rendered) {
    out.help = Cow::Borrowed(
        "React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in \
         event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not \
         to update as expected",
    );
    // `ref_update`
    if out.text() != "Cannot update ref during render" {
        return;
    }
    out.relabel("Cannot update ref value during render");
    let Some(whole) = out.place() else {
        return;
    };
    let Some(object) = find(file, whole, |node| Some(node.as_expr()?.object()?.span())) else {
        return;
    };
    let value = match whole.start == object.start && object.end < whole.end {
        true => Span::new(object.end, whole.end),
        false => whole,
    };
    out.move_to(Some(value));
    if object.end <= value.start || object.start >= value.end {
        out.push(object, "This value is a ref");
    }
}

/// `set_state_in_effect`. Which effect it is only the compiler knows, unless the call is written in its callback.
fn set_state_in_effect<'a>(file: &'a File<'a>, out: &mut Rendered) {
    out.help = Cow::Borrowed(
        "Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts \
         another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it \
         from the event that caused the change. Use an effect only when synchronizing with an external system.",
    );
    let effect = out.place().and_then(|at| effect_around(file, at));
    out.also(
        effect.map(|call| call.callee().span()),
        "This is the containing effect",
    );
}

/// `derived_state_in_effect_from_dependencies`. The compiler reports it only if the callback and the dependencies are written in
/// the call, and each dependency is a variable.
fn derived_state_in_effect<'a>(file: &'a File<'a>, out: &mut Rendered) {
    out.message = Cow::Borrowed(
        "Values derived from props and state should be calculated during render, not in an effect",
    );
    out.relabel("This state update stores a value that can be calculated during render");
    let effect = out.place().and_then(|at| effect_around(file, at));
    let dependencies = effect.and_then(|call| match call.args().get(1)?.kind() {
        ExprKind::Array(elements) => Some(elements),
        _ => None,
    });
    let total = dependencies.map_or(0, |all| all.len());
    let (mut names, mut seen) = (String::new(), FxHashSet::default());
    for (index, dependency) in dependencies.into_iter().flatten().enumerate() {
        if let Some(name) = dependency.as_ident()
            && seen.insert(name)
        {
            let separator = if names.is_empty() { "" } else { "`, `" };
            // Writing to a `String` does not fail.
            let _ = write!(names, "{separator}{name}");
        }
        let text = match (index, total) {
            (0, 1) => "This reactive value contributes to the derived state",
            (0, _) => "These reactive values contribute to the derived state",
            _ => "",
        };
        out.push(dependency.span(), text);
    }
    let values = match seen.len() {
        0 => "the effect's reactive dependencies".to_owned(),
        1 => format!("the reactive value `{names}`"),
        _ => format!("the reactive values `{names}`"),
    };
    out.help = Cow::Owned(format!(
        "This effect derives state from {values}, causing an extra render and potentially showing a stale value. Calculate the \
         derived value during render, then remove the redundant state and effect."
    ));
}

/// `jsx_in_try`
fn jsx_in_try<'a>(file: &'a File<'a>, out: &mut Rendered) {
    out.help = Cow::Borrowed(
        "React does not immediately render components when JSX is constructed, so rendering errors will not be caught by the \
         try/catch. Wrap the component in an error boundary instead",
    );
    let name = out.place().and_then(|at| {
        find(file, at, |node| match node.as_expr()?.kind() {
            ExprKind::Jsx(jsx) => Some(jsx.tag().map_or_else(|| jsx.opening_span(), Expr::span)),
            _ => None,
        })
    });
    out.move_to(name);
}

/// `impure_function`
fn purity(finding: &Finding, out: &mut Rendered) {
    let description = finding.description.as_deref().unwrap_or_default();
    if let Some(start) = strings::index_of(
        description.as_bytes(),
        b"Calling an impure function can produce",
    ) && let Some(prefix) = description.get(..start)
    {
        out.help = Cow::Owned(format!(
            "{prefix}Calling an impure function can produce unstable results that update unpredictably when the component \
             re-renders"
        ));
    }
}

fn set_state_in_render(finding: &Finding, out: &mut Rendered) {
    let description = finding.description.as_deref().unwrap_or_default();
    match finding.reason.as_str() {
        // `set_state_in_use_memo`
        "Calling setState from useMemo may trigger an infinite loop" => {
            out.help = Cow::Borrowed(
                "Each time the memo callback is evaluated it will change state. This can cause a memoization dependency to \
                 change, running the memo function again and causing an infinite loop. Instead of setting state in \
                 useMemo(), prefer deriving the value during render",
            );
        }
        // `set_state_in_render`. `set_state_in_render_with_keyed_state` says what the compiler says.
        "Cannot call setState during render"
            if !strings::contains(description.as_bytes(), b"useKeyedState") =>
        {
            out.help = Cow::Borrowed(
                "Calling setState during render may trigger an infinite loop.\n\
                 * To reset state when other state/props change, store the previous value in state and update conditionally.\n\
                 * To derive data from other state/props, compute the derived data during render without using state",
            );
        }
        _ => {}
    }
}

fn invariant(finding: &Finding, out: &mut Rendered) {
    // `empty_goto`, which is never told where.
    if finding.reason == "Unexpected empty block with `goto` terminal" {
        out.labels.clear();
    }
    // `invariant_build_hir_lower_assignment_could_not_find_binding_declaration`
    if finding.reason == "(BuildHIR::lowerAssignment) Could not find binding for declaration." {
        out.relabel("");
    }
}

fn todo<'a>(file: &'a File<'a>, finding: &Finding, out: &mut Rendered) {
    let reason = finding.reason.as_str();
    let between = |prefix: &str, suffix: &str| reason.strip_prefix(prefix)?.strip_suffix(suffix);
    let place = out.place();
    if reason == "(BuildHIR::lowerStatement) Handle TryStatement without a catch clause" {
        // `todo_build_hir_lower_statement_handle_try_statement_without_catch_clause`
        out.say(
            "`try`/`finally` without `catch` is not supported by React Compiler",
            "React Compiler cannot analyze this control flow. Refactor the cleanup to avoid `finally`, or suppress this \
             warning if this function should remain uncompiled",
        );
        out.relabel("Unsupported `try` starts here");
        out.move_to(place.map(|at| start_of(at, 3)));
        let finally = place.and_then(|at| {
            find(file, at, |node| match node.as_stmt()?.kind() {
                StmtKind::Try {
                    block,
                    finalizer: Some(finalizer),
                    ..
                } => Some(block.span().between(finalizer.span())),
                _ => None,
            })
        });
        out.also(
            finally,
            "This `finally` clause requires unsupported control flow",
        );
    } else if reason
        == "(BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause"
    {
        out.move_to(place.and_then(|at| {
            find(file, at, |node| match node.as_stmt()?.kind() {
                StmtKind::Try {
                    handler: Some(handler),
                    finalizer: Some(finalizer),
                    ..
                } => Some(handler.span().between(finalizer.span())),
                _ => None,
            })
        }));
    } else if reason == "(BuildHIR::lowerStatement) Handle for-await loops" {
        out.move_to(place.and_then(|at| {
            find(file, at, |node| match node.as_stmt()?.kind() {
                StmtKind::ForOf { left, .. } => Some(Span::before(at.start, left.span())),
                _ => None,
            })
        }));
    } else if reason == "(BuildHIR::lowerExpression) Handle ClassExpression expressions" {
        out.move_to(place.map(|at| {
            let name = find(file, at, |node| node.as_expr()?.as_class()?.name());
            name.map_or_else(
                || start_of(at, 5),
                |name| Span::new(at.start, name.span().end),
            )
        }));
    } else if reason == "(BuildHIR::lowerAssignment) Handle computed properties in ObjectPattern" {
        // The compiler marks the key here, oxc the property.
        out.move_to(place.and_then(|at| property_around(file, at)));
    } else if let Some(kind) = between(
        "(BuildHIR::lowerExpression) Handle ",
        " functions in ObjectExpression",
    ) {
        // `unsupported_object_method`
        out.relabel(format!("Unsupported {kind} function"));
        out.move_to(place.map(|at| start_of(at, kind.len() as u32)));
    } else if let Some(kind) = between(
        "(BuildHIR::lowerAssignment) Handle ",
        " rest element in ObjectPattern",
    ) {
        // `unsupported_object_pattern_rest`
        out.relabel(format!("Unsupported {kind} rest element"));
    } else if let Some(kind) = between(
        "(BuildHIR::node.lowerReorderableExpression) Expression type `",
        "` cannot be safely reordered",
    ) {
        // `unsafe_reorderable_expression`
        out.relabel(format!("`{kind}` cannot be safely reordered"));
        let func = place.and_then(|at| function_at(file, at));
        out.move_to(func.map(crate::program::diagnostic_span));
    } else if reason
        == "Support functions with unreachable code that may contain hoisted declarations"
    {
        let func = place.and_then(|at| function_at(file, at));
        out.move_to(func.map(crate::program::diagnostic_span));
    } else if reason == LOCAL_FBT {
        // `local_fbt_variable`, which is told where the variable is declared.
        out.relabel("Local variables named `fbt` are not supported");
        out.move_to(place.and_then(|at| declaration_of(file, at)));
    } else if reason == "[hoisting] EnterSSA: Expected identifier to be defined before being used" {
        // `undefined_ssa_identifier`
        let description = finding.description.as_deref().unwrap_or_default();
        let name = description.strip_prefix("Identifier ");
        if let Some(name) = name.and_then(|it| it.strip_suffix(" is undefined")) {
            out.relabel(format!("`{name}` is used before it is defined"));
        }
    }
}

fn syntax<'a>(file: &'a File<'a>, finding: &Finding, out: &mut Rendered) {
    match finding.reason.as_str() {
        // `const_reassignment`
        "Cannot reassign a `const` variable" => {
            let description = finding.description.as_deref().unwrap_or_default();
            let Some(name) = description.strip_suffix(" is declared as const") else {
                return;
            };
            out.relabel(format!("Cannot reassign {name}"));
            if let Some(declaration) = out.place().and_then(|at| declaration_of(file, at)) {
                out.push(declaration, format!("{name} is declared here"));
            }
        }
        // `invalid_jsx_namespace`
        "Expected JSXNamespacedName to have no colons in the namespace or name" => {
            out.relabel("JSX namespace names cannot contain additional colons");
        }
        _ => {}
    }
}

fn unsupported_syntax(finding: &Finding, out: &mut Rendered) {
    match finding.reason.as_str() {
        // `unsupported_eval`
        "The 'eval' function is not supported" => {
            out.relabel("`eval` cannot be analyzed by React Compiler")
        }
        // `unsupported_with_statement`
        "JavaScript 'with' syntax is not supported" => {
            out.relabel("`with` cannot be analyzed by React Compiler")
        }
        // `unsupported_inline_class`
        "Inline `class` declarations are not supported" => {
            out.relabel("Move this class outside the component or hook");
        }
        _ => {}
    }
}

/// `suppression`: what the compiler says is the note.
fn suppression(finding: &Finding, out: &mut Rendered) {
    out.say(
        "React rule suppression prevents optimization",
        default_help(ErrorCategory::Suppression),
    );
    out.note = Cow::Owned(match &finding.description {
        Some(description) => format!("{}. {description}", finding.reason),
        None => finding.reason.clone(),
    });
}
