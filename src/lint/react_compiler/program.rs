//! Decides which of a file's functions the compiler runs on, and what happens to the diagnostics. This is what
//! `oxc_react_compiler::lint()` does around its pipeline (`lib.rs`, `react_compiler/entrypoint/program.rs`,
//! `imports.rs`), function by function and under the same names.
//!
//! The options are oxlint's, which are fixed: `compilation_mode: infer`, `panic_threshold: none`, `target: 19`, the
//! output mode `lint`, no gating, no custom directives, no forbidden imports. Code that only other values can reach
//! isn't ported.
//!
//! [`Flavor::Eslint`] is what `eslint-plugin-react-hooks` does with the same options, which are its defaults. That's
//! the `Program.ts` that oxc's file is a port of, running on Babel's tree, with the plugin's `RunReactCompiler.ts`
//! around it. The two differ where oxc's tree isn't Babel's (parentheses, parameters, directives), where oxc lists what
//! to walk and Babel's `traverse` goes everywhere, and in which files they look at in the first place.
//!
//! Nothing here recurses. Where oxc and Babel walk recursively, this keeps a worklist.

use crate::compile::{Compiler, Flavor};
use crate::finding::Finding;
use crate::suppression::{
    ProgramSuppressions, find_program_suppressions, remove_flow_suppressed,
    suppressions_to_diagnostics,
};
use bun_core::strings;
use bun_lint::ast::{
    Call, Chain, Class, Expr, ExprKind, ExprTag, File, Flags, FnBody, FnKind, Func, Ident, Jsx,
    Key, KeyKind, Keyword, List, MemberKind, Name, Node, Param, Pat, PatKind, Prop, PropKind, Stmt,
    StmtKind, StmtTag, TypeKind, TypeNode, UnOp, VarDecl, VarKind,
};
use bun_lint::span::Span;
use bun_react_compiler::Categories;
use bun_react_compiler::diagnostics::ErrorCategory;
use bun_react_compiler::environment::is_hook_name;
use bun_react_compiler::hir::ReactFunctionType;

/// oxlint's `eslint_suppression_rules`: the compiler's defaults, plus oxlint's names for the same rules.
const ESLINT_SUPPRESSION_RULES: [&str; 4] = [
    "react-hooks/exhaustive-deps",
    "react-hooks/rules-of-hooks",
    "react/exhaustive-deps",
    "react/rules-of-hooks",
];

/// Directives that opt a function into memoization
const OPT_IN_DIRECTIVES: [&str; 2] = ["use forget", "use memo"];

/// Directives that opt a function out of memoization
const OPT_OUT_DIRECTIVES: [&str; 2] = ["use no forget", "use no memo"];

/// oxc's `get_react_compiler_runtime_module`
const REACT_COMPILER_RUNTIME_MODULE: &str = "react/compiler-runtime";

/// A function found in the program that should be compiled.
struct CompileSource<'a> {
    fn_type: ReactFunctionType,
    fn_node: Func<'a>,
}

// ───────────────────────────── directives ─────────────────────────────

/// True if one of the string statements at the start of the function's body is one of `directives`. oxc compares their
/// values. Babel's `DirectiveLiteral.value` is the raw text between the quotes.
fn has_body_directive(func: Func<'_>, flavor: Flavor, directives: &[&str]) -> bool {
    let statements = func.body_statements().into_iter().flatten();
    let mut leading = statements.map_while(|statement| match statement.kind() {
        StmtKind::Expr(expression) if !expression.is_parenthesized() => {
            Some((expression, expression.as_string()?))
        }
        _ => None,
    });
    leading.any(|(expression, value)| match flavor {
        Flavor::Oxlint => value.is_any(directives),
        Flavor::Eslint => match expression.text() {
            [_, raw_text @ .., _] => directives.iter().any(|it| it.as_bytes() == raw_text),
            _ => false,
        },
    })
}

fn try_find_directive_enabling_memoization(func: Func<'_>, flavor: Flavor) -> bool {
    has_body_directive(func, flavor, &OPT_IN_DIRECTIVES)
}

fn find_directive_disabling_memoization(func: Func<'_>, flavor: Flavor) -> bool {
    has_body_directive(func, flavor, &OPT_OUT_DIRECTIVES)
}

// ───────────────────────────── names ─────────────────────────────

/// Check if a name looks like a React component (starts with uppercase letter).
fn is_component_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_uppercase)
}

/// True if `expr` is in a `ParenthesizedExpression`. oxc's tree has these nodes, and a match on an expression's kind
/// doesn't see through them. Babel's tree doesn't have them.
fn is_parenthesized_expression(expr: Expr<'_>, flavor: Flavor) -> bool {
    flavor == Flavor::Oxlint && expr.is_parenthesized()
}

/// Check if an expression is a hook call (identifier with hook name, or member expression `PascalCase.useHook`). The
/// `Foo?.useHook` in `(Foo?.useHook)()` doesn't count: Babel has a different node type for it, and oxc sees the
/// parentheses.
fn expr_is_hook(expr: Expr<'_>, flavor: Flavor) -> bool {
    if is_parenthesized_expression(expr, flavor) {
        return false;
    }
    match expr.kind() {
        ExprKind::Ident(name) => is_hook_name(name.bytes()),
        ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
        } => {
            is_hook_name(name.bytes())
                && !is_parenthesized_expression(obj, flavor)
                && obj
                    .as_ident()
                    .is_some_and(|obj| is_component_name(obj.bytes()))
        }
        _ => false,
    }
}

/// True if neither the call nor its callee has a `?.`. That's Babel's `CallExpression`, as opposed to its
/// `OptionalCallExpression`. oxc's `expr_contains_optional` stops at parentheses and at `!`, which makes no difference
/// for a callee that [`expr_is_hook`] accepts.
fn is_regular_call(call: Call<'_>) -> bool {
    call.chain() == Chain::No
}

/// Babel's `FunctionDeclaration`, `FunctionExpression` and `ArrowFunctionExpression`. These can be compiled, and a
/// search inside a function doesn't descend into them. A method is none of these.
fn is_function(func: Func<'_>) -> bool {
    matches!(func.kind(), FnKind::Decl | FnKind::Expr | FnKind::Arrow)
}

// ───────────────────────────── what a function returns and calls ─────────────────────────────

/// Check if an expression is a "non-node" return value (indicating the function is not a React component).
fn is_non_node(expr: Expr<'_>) -> bool {
    matches!(
        expr.tag(),
        ExprTag::Object | ExprTag::Fn | ExprTag::BigInt | ExprTag::Class | ExprTag::New
    )
}

/// Worklist for the searches inside a function: the nodes still to visit, in no particular order.
struct Search<'a> {
    flavor: Flavor,
    pending: Vec<Node<'a>>,
}

impl<'a> Search<'a> {
    fn new(flavor: Flavor) -> Self {
        Search {
            flavor,
            pending: Vec::new(),
        }
    }

    fn look(&mut self, node: impl Into<Node<'a>>) {
        self.pending.push(node.into());
    }

    fn look_all<T: Into<Node<'a>>>(&mut self, nodes: impl IntoIterator<Item = T>) {
        self.pending.extend(nodes.into_iter().map(Into::into));
    }

    /// Queues all of `node`'s children, like Babel's `traverse`, except types. There's nothing to find in a type,
    /// unless a member's name is computed from something that TypeScript doesn't allow there.
    fn look_into(&mut self, node: Node<'a>) {
        let pending = &mut self.pending;
        node.for_each_child(|child| {
            if !matches!(child, Node::Type(_) | Node::TypeParam(_)) {
                pending.push(child);
            }
        });
    }

    /// Check if a function returns non-node values. The `return` statements are visited in source order, and the last
    /// one visited decides.
    fn returns_non_node_fn(&mut self, func: Func<'a>) -> bool {
        let last = match (self.flavor, func.body()) {
            (Flavor::Oxlint, FnBody::Expr(expr)) => return is_non_node(expr),
            (Flavor::Eslint, _) if func.file().has_classes() => self.last_return_statement(func),
            _ => func
                .returns()
                .max_by_key(|statement| statement.span().start),
        };
        match (last.map(Stmt::kind), func.body()) {
            (Some(StmtKind::Return(Some(arg))), _) | (None, FnBody::Expr(arg)) => is_non_node(arg),
            (Some(_), _) => true,
            (None, _) => false,
        }
    }

    /// The plugin's `returnsNonNode` skips nested functions and object methods, but not class methods, so their
    /// `return` statements count as the function's.
    fn last_return_statement(&mut self, func: Func<'a>) -> Option<Stmt<'a>> {
        let mut last: Option<Stmt<'a>> = None;
        self.pending.clear();
        self.look_into(Node::Func(func));
        while let Some(node) = self.pending.pop() {
            match node {
                Node::Func(nested) if !matches!(nested.owner(), Node::Member(_)) => continue,
                Node::Stmt(statement)
                    if statement.tag() == StmtTag::Return
                        && last.is_none_or(|it| it.span().start < statement.span().start) =>
                {
                    last = Some(statement);
                }
                _ => {}
            }
            self.look_into(node);
        }
        last
    }

    /// Check if a function calls hooks or creates JSX, in its parameters or its body, not in nested functions.
    fn calls_hooks_or_creates_jsx(&mut self, func: Func<'a>) -> bool {
        self.pending.clear();
        if self.flavor == Flavor::Eslint {
            return self.calls_hooks_or_creates_jsx_anywhere(func);
        }
        self.calls_hooks_or_creates_jsx_in_params(func);
        match func.body() {
            FnBody::Block(statements) => self.look_all(statements),
            FnBody::Expr(expr) => self.look(expr),
            FnBody::None => {}
        }
        while let Some(node) = self.pending.pop() {
            match node {
                Node::Stmt(stmt) => self.calls_hooks_or_creates_jsx_in_stmt(stmt),
                Node::Expr(expr) => {
                    if self.calls_hooks_or_creates_jsx_in_expr(expr) {
                        return true;
                    }
                }
                Node::Pat(pattern) => self.calls_hooks_or_creates_jsx_in_binding(pattern),
                _ => {}
            }
        }
        false
    }

    /// The plugin's `callsHooksOrCreatesJsx`: everywhere except in nested functions. Object and class methods don't
    /// count as nested functions.
    fn calls_hooks_or_creates_jsx_anywhere(&mut self, func: Func<'a>) -> bool {
        self.look_into(Node::Func(func));
        while let Some(node) = self.pending.pop() {
            let is_found = match node {
                Node::Func(nested) if is_function(nested) => continue,
                Node::Expr(expr) => match expr.kind() {
                    ExprKind::Jsx(_) => true,
                    ExprKind::Call(call) => {
                        is_regular_call(call) && expr_is_hook(call.callee(), self.flavor)
                    }
                    _ => false,
                },
                _ => false,
            };
            if is_found {
                return true;
            }
            self.look_into(node);
        }
        false
    }

    fn calls_hooks_or_creates_jsx_in_stmt(&mut self, stmt: Stmt<'a>) {
        match stmt.kind() {
            StmtKind::Expr(expr) | StmtKind::Throw(expr) => self.look(expr),
            StmtKind::Return(arg) => self.look_all(arg),
            StmtKind::Var(declarations) => {
                self.look_all(declarations.iter().filter_map(VarDecl::init))
            }
            StmtKind::Block(statements) => self.look_all(statements),
            StmtKind::If { test, yes, no } => {
                self.look(test);
                self.look(yes);
                self.look_all(no);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.look_all(init);
                self.look_all(test);
                self.look_all(update);
                self.look(body);
            }
            StmtKind::While { test, body } | StmtKind::DoWhile { body, test } => {
                self.look(test);
                self.look(body);
            }
            StmtKind::ForIn { expr, body, .. } | StmtKind::ForOf { expr, body, .. } => {
                self.look(expr);
                self.look(body);
            }
            StmtKind::Switch { expr, cases } => {
                self.look(expr);
                for case in cases {
                    self.look_all(case.test());
                    self.look_all(case.body());
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.look(block);
                self.look_all(handler);
                self.look_all(finalizer);
            }
            StmtKind::Labeled { body, .. } => self.look(body),
            StmtKind::With { object, body } => {
                self.look(object);
                self.look(body);
            }
            // Nested functions, classes, and TypeScript-only statements.
            _ => {}
        }
    }

    /// True if `expr` itself is JSX or a hook call. Its children are queued.
    fn calls_hooks_or_creates_jsx_in_expr(&mut self, expr: Expr<'a>) -> bool {
        match expr.kind() {
            ExprKind::Jsx(_) => return true,
            ExprKind::Call(call) => {
                if is_regular_call(call) && expr_is_hook(call.callee(), self.flavor) {
                    return true;
                }
                self.look(call.callee());
                self.look_all(call.args());
            }
            ExprKind::Binary { left, right, .. } => {
                self.look(left);
                self.look(right);
            }
            ExprKind::Cond { test, yes, no } => {
                self.look(test);
                self.look(yes);
                self.look(no);
            }
            ExprKind::Assign { value, .. } => self.look(value),
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } => {
                if matches!(operand.tag(), ExprTag::Dot | ExprTag::Index) {
                    self.look(operand);
                }
            }
            ExprKind::Index { obj, index, .. } => {
                self.look(obj);
                self.look(index);
            }
            ExprKind::Yield { value, .. } => self.look_all(value),
            ExprKind::TaggedTemplate(call) => {
                self.look(call.callee());
                self.look_all(call.template());
            }
            ExprKind::Template(template) => self.look_all(template.exprs()),
            ExprKind::Array(elements) => self.look_all(elements),
            ExprKind::Object(properties) => {
                for property in properties {
                    match property.kind() {
                        // Keys aren't checked, and neither are a method's parameters.
                        PropKind::Method | PropKind::Getter | PropKind::Setter => {
                            self.look_all(
                                property
                                    .func()
                                    .and_then(Func::body_statements)
                                    .into_iter()
                                    .flatten(),
                            );
                        }
                        PropKind::Init | PropKind::Shorthand | PropKind::Spread => {
                            self.look_all(property.value())
                        }
                    }
                }
            }
            ExprKind::New(call) => {
                self.look(call.callee());
                self.look_all(call.args());
            }
            ExprKind::Unary { operand: inner, .. }
            | ExprKind::Dot { obj: inner, .. }
            | ExprKind::Await(inner)
            | ExprKind::Spread(inner)
            | ExprKind::As { expr: inner, .. }
            | ExprKind::Satisfies { expr: inner, .. }
            | ExprKind::AsConst(inner)
            | ExprKind::NonNull(inner)
            | ExprKind::Instantiation { expr: inner, .. } => self.look(inner),
            // Nested functions, classes, `import()`, and expressions without children.
            _ => {}
        }
        false
    }

    /// Queues the parameters' defaults, including those inside their patterns.
    fn calls_hooks_or_creates_jsx_in_params(&mut self, func: Func<'a>) {
        for param in func.params() {
            self.look_all(param.default());
            self.look(param.pat());
        }
    }

    fn calls_hooks_or_creates_jsx_in_binding(&mut self, pattern: Pat<'a>) {
        match pattern.kind() {
            PatKind::Missing | PatKind::Ident(_) => {}
            PatKind::Object(properties) => {
                for property in properties {
                    self.look_all(property.default());
                    self.look(property.value());
                }
            }
            PatKind::Array(elements) => {
                for element in elements {
                    self.look_all(element.default());
                    self.look_all(element.pat());
                }
            }
        }
    }
}

// ───────────────────────────── parameters ─────────────────────────────

/// Check if a parameter's type annotation is valid for a React component prop. Returns false for primitive type
/// annotations that indicate this is NOT a component. Both oxc and Babel have a separate node for a parenthesized type,
/// and it isn't one of them. For Babel, a template with substitutions is a `TSLiteralType`.
fn is_valid_props_annotation(type_annotation: Option<TypeNode<'_>>, flavor: Flavor) -> bool {
    let Some(annotation) = type_annotation else {
        return true;
    };
    let is_primitive = matches!(annotation.kind(), TypeKind::Template(_) if flavor == Flavor::Eslint)
        || matches!(
            annotation.kind(),
            TypeKind::Array(_)
                | TypeKind::Keyword(
                    Keyword::BigInt
                        | Keyword::Boolean
                        | Keyword::Never
                        | Keyword::Number
                        | Keyword::String
                        | Keyword::Symbol
                )
                | TypeKind::Fn(_)
                | TypeKind::StringLit(_)
                | TypeKind::NumberLit(_)
                | TypeKind::BigIntLit { .. }
                | TypeKind::BoolLit(_)
                | TypeKind::Tuple(_)
        );
    !is_primitive || annotation.is_parenthesized()
}

/// Check if the function parameters are valid for a React component. Components can have 0 params, 1 param (props), or 2 params
/// (props + ref).
///
/// In Babel's tree `this: T` is the first parameter, and a parameter with a default is an `AssignmentPattern`, which
/// has no annotation and isn't an identifier.
fn is_valid_component_params(func: Func<'_>, flavor: Flavor) -> bool {
    let this_param = match flavor {
        Flavor::Oxlint => None,
        Flavor::Eslint => func.this_param(),
    };
    let mut params = this_param.into_iter().chain(func.params());
    let Some(first) = params.next() else {
        return true;
    };
    let (second, third) = (params.next(), params.next());
    let is_assignment_pattern =
        |param: Param<'_>| flavor == Flavor::Eslint && param.default().is_some();
    let annotation = match is_assignment_pattern(first) {
        true => None,
        false => first.ty(),
    };
    if third.is_some() || first.is_rest() || !is_valid_props_annotation(annotation, flavor) {
        return false;
    }
    let Some(second) = second else {
        return true;
    };
    !second.is_rest()
        && !is_assignment_pattern(second)
        && second.pat().as_ident().is_some_and(|name| {
            strings::contains(name.bytes(), b"ref") || strings::contains(name.bytes(), b"Ref")
        })
}

// ───────────────────────────── the type of a function ─────────────────────────────

/// Determine the React function type for a function, given its name and context.
fn get_react_function_type<'a>(
    name: Option<Name<'a>>,
    func: Func<'a>,
    parent_callee_name: Option<Name<'a>>,
    search: &mut Search<'a>,
) -> Option<ReactFunctionType> {
    let component_or_hook_like = get_component_or_hook_like(name, func, parent_callee_name, search);
    match try_find_directive_enabling_memoization(func, search.flavor) {
        true => Some(component_or_hook_like.unwrap_or(ReactFunctionType::Other)),
        false => component_or_hook_like,
    }
}

/// Determine if a function looks like a React component or hook based on naming conventions and code patterns.
fn get_component_or_hook_like<'a>(
    name: Option<Name<'a>>,
    func: Func<'a>,
    parent_callee_name: Option<Name<'a>>,
    search: &mut Search<'a>,
) -> Option<ReactFunctionType> {
    if let Some(fn_name) = name {
        if is_component_name(fn_name.bytes()) {
            let is_component = is_valid_component_params(func, search.flavor)
                && !search.returns_non_node_fn(func)
                && search.calls_hooks_or_creates_jsx(func);
            return is_component.then_some(ReactFunctionType::Component);
        } else if is_hook_name(fn_name.bytes()) {
            // Hooks have hook invocations or JSX, but can take any # of arguments
            return search
                .calls_hooks_or_creates_jsx(func)
                .then_some(ReactFunctionType::Hook);
        }
    }

    // For unnamed functions, check if they are forwardRef/memo callbacks
    if parent_callee_name.is_some() {
        return search
            .calls_hooks_or_creates_jsx(func)
            .then_some(ReactFunctionType::Component);
    }

    None
}

/// Extract the callee name from a CallExpression if it's a React API call (forwardRef, memo, React.forwardRef, React.memo).
///
/// The plugin's `isReactAPI` doesn't check whether the property is computed, so `React[memo]` counts too. `React?.memo`
/// doesn't count there, because it's an `OptionalMemberExpression`.
fn get_callee_name_if_react_api(callee: Expr<'_>, flavor: Flavor) -> Option<Name<'_>> {
    const NAMES: [&str; 2] = ["forwardRef", "memo"];
    if is_parenthesized_expression(callee, flavor) {
        return None;
    }
    let (obj, name) = match callee.kind() {
        ExprKind::Ident(name) => return name.is_any(&NAMES).then_some(name),
        ExprKind::Dot { obj, name, chain } if flavor == Flavor::Oxlint || chain == Chain::No => {
            (obj, name.name())
        }
        ExprKind::Index {
            obj,
            index,
            chain: Chain::No,
        } if flavor == Flavor::Eslint => (obj, index.as_ident()?),
        _ => return None,
    };
    (name.is_any(&NAMES) && obj.is_ident("React") && !is_parenthesized_expression(obj, flavor))
        .then_some(name)
}

/// The plugin's `isMemoCallback` and `isForwardRefCallback`: the function is a direct argument of the call.
fn get_callee_name_if_react_api_callback(func: Func<'_>) -> Option<Name<'_>> {
    let Node::Expr(parent) = func.owner().parent() else {
        return None;
    };
    let call = parent.as_call().filter(|call| is_regular_call(*call))?;
    get_callee_name_if_react_api(call.callee(), Flavor::Eslint)
}

// ───────────────────────────── errors ─────────────────────────────

/// oxc's `FunctionNode::diagnostic_span`: the function's own name if it has one. Otherwise its head, through the body's
/// `{` or up to the start of the body expression.
pub(crate) fn diagnostic_span(func: Func<'_>) -> Span {
    if let Some(id) = func.name() {
        return id.span();
    }
    let span = func.estree_span();
    let end = match func.body() {
        FnBody::Expr(expression) => expression.outer_span().start,
        FnBody::Block(_) | FnBody::None => func
            .body_span()
            .map_or(span.end, |body| body.start.saturating_add(1)),
    };
    Span::new(span.start, end.min(span.end))
}

/// Push a failed compilation attempt's diagnostics onto the accumulator. oxc's `with_fallback_label` is left to the
/// renderer.
fn log_error(err: Vec<Finding>, fn_span: Option<Span>, diagnostics: &mut Vec<Finding>) {
    diagnostics.extend(err.into_iter().map(|diagnostic| Finding {
        function_span: fn_span,
        ..diagnostic
    }));
}

/// With `panic_threshold: none`, only a configuration error ends the run.
fn should_panic(diagnostics: &[Finding]) -> bool {
    diagnostics
        .iter()
        .any(|diagnostic| diagnostic.category == ErrorCategory::Config)
}

/// oxc's `CompileResult::Fatal`: no further function is compiled. The diagnostics so far are still reported.
struct Fatal;

fn handle_error(
    err: Vec<Finding>,
    fn_span: Option<Span>,
    diagnostics: &mut Vec<Finding>,
) -> Result<(), Fatal> {
    let is_fatal = should_panic(&err);
    log_error(err, fn_span, diagnostics);
    if is_fatal { Err(Fatal) } else { Ok(()) }
}

// ───────────────────────────── one function ─────────────────────────────

/// The parts of oxc's `ProgramContext` that are used when nothing is emitted.
struct ProgramContext<'a> {
    flavor: Flavor,
    compiler: Compiler<'a>,
    suppressions: ProgramSuppressions<'a>,
    diagnostics: Vec<Finding>,
}

/// Attempt to compile a single function. `Err` has the failed attempt's diagnostics.
fn try_compile_function<'a>(
    source: &CompileSource<'a>,
    context: &mut ProgramContext<'a>,
) -> Result<(), Vec<Finding>> {
    // Check for suppressions that affect this function before entering the pipeline.
    let span = source.fn_node.estree_span();
    let affecting = context
        .suppressions
        .filter_suppressions_that_affect_function(span.start, span.end);
    if !affecting.is_empty() {
        return Err(suppressions_to_diagnostics(&affecting));
    }

    context
        .compiler
        .compile_fn(source.fn_node, source.fn_type, &mut context.diagnostics)
}

/// Process a single function: check directives, attempt compilation, handle results. When nothing is emitted, the only
/// effect of `"use no memo"` is that a configuration error doesn't end the run. The function's diagnostics are reported
/// like any other's.
fn process_fn<'a>(
    source: &CompileSource<'a>,
    context: &mut ProgramContext<'a>,
) -> Result<(), Fatal> {
    // The plugin drops a diagnostic that has no location.
    let diagnostic_span = match context.flavor {
        Flavor::Oxlint => Some(diagnostic_span(source.fn_node)),
        Flavor::Eslint => None,
    };
    let opt_out = find_directive_disabling_memoization(source.fn_node, context.flavor);

    match try_compile_function(source, context) {
        Err(err) if opt_out => {
            log_error(err, diagnostic_span, &mut context.diagnostics);
            Ok(())
        }
        Err(err) => handle_error(err, diagnostic_span, &mut context.diagnostics),
        Ok(()) => Ok(()),
    }
}

// ───────────────────────────── discovery ─────────────────────────────

/// Try to create a `CompileSource` from a function declaration, a function expression or an arrow function.
fn try_make_compile_source<'a>(
    fn_node: Func<'a>,
    name: Option<Name<'a>>,
    parent_callee_name: Option<Name<'a>>,
    search: &mut Search<'a>,
) -> Option<CompileSource<'a>> {
    // `declare function`, overload signatures
    if !fn_node.has_body() {
        return None;
    }
    let fn_type = get_react_function_type(name, fn_node, parent_callee_name, search)?;
    Some(CompileSource { fn_type, fn_node })
}

/// Get the variable declarator name (for inferring function names from `const Foo = () => {}`).
fn get_declarator_name(decl: VarDecl<'_>) -> Option<Name<'_>> {
    decl.pat().as_ident()
}

/// The expression of a key that's computed from more than a literal.
fn computed_key(key: Option<Key<'_>>) -> Option<Expr<'_>> {
    match key?.kind() {
        KeyKind::Computed(expression) => Some(expression),
        _ => None,
    }
}

/// A [`DiscoveryWalker`]'s next step.
enum Step<'a> {
    /// A statement, an expression or a binding pattern.
    Walk(Node<'a>),
    /// A function that's a declarator's initializer, and the declarator's name.
    WalkFunction(Func<'a>, Option<Name<'a>>),
    PopParentCallee,
}

/// Walks the file to find compilable functions, in source order.
///
/// Compiled functions have their bodies skipped. Other functions are descended to find nested components and hooks. Not
/// walked: classes, namespaces, enums, `export =`, `import()`, the targets of assignments and of `for`-`in` and
/// `for`-`of`, and the patterns of declarators and of `catch`. Of these, the plugin only skips classes: see
/// [`DiscoveryWalker::traverse`].
struct DiscoveryWalker<'a> {
    search: Search<'a>,
    queue: Vec<CompileSource<'a>>,
    /// One entry per call and function enclosing the current node: the callee's name if it's a `memo` or `forwardRef`
    /// call.
    parent_callee_stack: Vec<Option<Name<'a>>>,
    /// A stack: the next step is the last.
    steps: Vec<Step<'a>>,
}

impl<'a> DiscoveryWalker<'a> {
    fn new(search: Search<'a>) -> Self {
        DiscoveryWalker {
            search,
            queue: Vec::new(),
            parent_callee_stack: Vec::new(),
            steps: Vec::new(),
        }
    }

    fn current_parent_callee(&self) -> Option<Name<'a>> {
        self.parent_callee_stack.last().copied().flatten()
    }

    /// Queues `node` after whatever this step has already queued.
    fn walk(&mut self, node: impl Into<Node<'a>>) {
        self.steps.push(Step::Walk(node.into()));
    }

    fn walk_all<T: Into<Node<'a>>>(&mut self, nodes: impl IntoIterator<Item = T>) {
        self.steps
            .extend(nodes.into_iter().map(|node| Step::Walk(node.into())));
    }

    fn walk_program(&mut self, file: &'a File<'a>) {
        self.walk_all(file.body());
        self.steps.reverse();
        while let Some(step) = self.steps.pop() {
            let added = self.steps.len();
            match step {
                Step::Walk(node) if self.search.flavor == Flavor::Eslint => self.traverse(node),
                Step::Walk(Node::Stmt(stmt)) => self.walk_statement(stmt),
                Step::Walk(Node::Expr(expr)) => self.walk_expression(expr),
                Step::Walk(Node::Pat(pattern)) => self.walk_binding_pattern(pattern),
                Step::Walk(_) => {}
                Step::WalkFunction(func, inferred_name) => self.walk_function(func, inferred_name),
                Step::PopParentCallee => {
                    self.parent_callee_stack.pop();
                }
            }
            if let Some(added) = self.steps.get_mut(added..) {
                added.reverse();
            }
        }
    }

    /// The plugin's `findFunctionsToCompile`. Babel's `traverse` goes everywhere except into classes and into queued
    /// functions. Types are skipped too, because they can't contain a function.
    fn traverse(&mut self, node: Node<'a>) {
        let is_skipped = match node {
            Node::Class(_) | Node::Type(_) | Node::TypeParam(_) => true,
            Node::Stmt(stmt) => matches!(stmt.tag(), StmtTag::Interface | StmtTag::TypeAlias),
            _ => false,
        };
        match node {
            _ if is_skipped => {}
            Node::Func(func) if is_function(func) => {
                self.walk_function(func, declarator_name_for(func))
            }
            _ => self.traverse_children(node),
        }
    }

    fn traverse_children(&mut self, node: Node<'a>) {
        let steps = &mut self.steps;
        node.for_each_child(|child| steps.push(Step::Walk(child)));
    }

    fn walk_formal_parameters(&mut self, func: Func<'a>) {
        for param in func.params() {
            self.walk_all(param.decorators());
            self.walk(param.pat());
            self.walk_all(param.default());
        }
    }

    fn walk_binding_pattern(&mut self, pattern: Pat<'a>) {
        match pattern.kind() {
            PatKind::Missing | PatKind::Ident(_) => {}
            PatKind::Object(properties) => {
                for property in properties {
                    self.walk_all(computed_key(property.key()));
                    self.walk(property.value());
                    self.walk_all(property.default());
                }
            }
            PatKind::Array(elements) => {
                for element in elements {
                    self.walk_all(element.pat());
                    self.walk_all(element.default());
                }
            }
        }
    }

    fn walk_statement(&mut self, stmt: Stmt<'a>) {
        match stmt.kind() {
            StmtKind::Block(statements) => self.walk_all(statements),
            StmtKind::Return(arg) => self.walk_all(arg),
            StmtKind::Expr(expr) | StmtKind::Throw(expr) | StmtKind::ExportDefault(expr) => {
                self.walk(expr)
            }
            StmtKind::If { test, yes, no } => {
                self.walk(test);
                self.walk(yes);
                self.walk_all(no);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.walk_all(init);
                self.walk_all(test);
                self.walk_all(update);
                self.walk(body);
            }
            StmtKind::While { test, body } => {
                self.walk(test);
                self.walk(body);
            }
            StmtKind::DoWhile { body, test } => {
                self.walk(body);
                self.walk(test);
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                if left.tag() == StmtTag::Var {
                    self.walk(left);
                }
                self.walk(expr);
                self.walk(body);
            }
            StmtKind::Switch { expr, cases } => {
                self.walk(expr);
                for case in cases {
                    self.walk_all(case.test());
                    self.walk_all(case.body());
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.walk(block);
                self.walk_all(handler);
                self.walk_all(finalizer);
            }
            StmtKind::Labeled { body, .. } => self.walk(body),
            StmtKind::Var(declarations) => self.walk_variable_declaration(declarations),
            StmtKind::Fn(func) => self.walk_function(func, None),
            StmtKind::With { object, body } => {
                self.walk(object);
                self.walk(body);
            }
            _ => {}
        }
    }

    fn walk_variable_declaration(&mut self, declarations: List<'a, VarDecl<'a>>) {
        for declarator in declarations {
            let Some(init) = declarator.init() else {
                continue;
            };
            // The declarator's name only applies if the function is the whole initializer, parenthesized or not.
            match init.as_fn() {
                Some(func) => self
                    .steps
                    .push(Step::WalkFunction(func, get_declarator_name(declarator))),
                None => self.walk(init),
            }
        }
    }

    /// oxc's `walk_function` and `walk_arrow`. `inferred_name` is the name from the enclosing variable declarator. A
    /// function declaration uses its own name, a function expression never does.
    fn walk_function(&mut self, func: Func<'a>, inferred_name: Option<Name<'a>>) {
        let name = match func.kind() {
            FnKind::Decl => func.name().map(Ident::name),
            _ => inferred_name,
        };
        let parent_callee = match self.search.flavor {
            Flavor::Oxlint => self.current_parent_callee(),
            Flavor::Eslint => get_callee_name_if_react_api_callback(func),
        };
        if let Some(source) = try_make_compile_source(func, name, parent_callee, &mut self.search) {
            self.queue.push(source);
            return;
        }
        if self.search.flavor == Flavor::Eslint {
            return self.traverse_children(Node::Func(func));
        }

        // The enclosing call identifies only its direct function argument; nested functions must not inherit `memo` /
        // `forwardRef` context.
        self.parent_callee_stack.push(None);
        self.walk_formal_parameters(func);
        match func.body() {
            FnBody::Block(statements) => self.walk_all(statements),
            FnBody::Expr(expression) => self.walk(expression),
            FnBody::None => {}
        }
        self.steps.push(Step::PopParentCallee);
    }

    fn walk_expression(&mut self, expr: Expr<'a>) {
        match expr.kind() {
            ExprKind::Fn(func) => self.walk_function(func, None),
            ExprKind::Call(call) => {
                // oxc's `walk_chain_element`: a call that's a whole optional chain pushes no callee, so its arguments
                // are treated as those of the enclosing call.
                let is_chain_element = call.chain() != Chain::No && expr.is_chain_root();
                if !is_chain_element {
                    self.parent_callee_stack
                        .push(get_callee_name_if_react_api(call.callee(), Flavor::Oxlint));
                }
                self.walk(call.callee());
                self.walk_all(call.args());
                if !is_chain_element {
                    self.steps.push(Step::PopParentCallee);
                }
            }
            ExprKind::Index { obj, index, .. } => {
                self.walk(obj);
                self.walk(index);
            }
            ExprKind::Binary { left, right, .. } => {
                self.walk(left);
                self.walk(right);
            }
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } => {
                if matches!(operand.tag(), ExprTag::Dot | ExprTag::Index) {
                    self.walk(operand);
                }
            }
            ExprKind::Cond { test, yes, no } => {
                self.walk(test);
                self.walk(yes);
                self.walk(no);
            }
            ExprKind::Assign { value, .. } => self.walk(value),
            ExprKind::Object(properties) => {
                for property in properties {
                    self.walk_object_property(property);
                }
            }
            ExprKind::Array(elements) => self.walk_all(elements),
            ExprKind::New(call) => {
                self.walk(call.callee());
                self.walk_all(call.args());
            }
            ExprKind::Template(template) => self.walk_all(template.exprs()),
            ExprKind::TaggedTemplate(call) => {
                self.walk(call.callee());
                self.walk_all(call.template());
            }
            ExprKind::Yield { value, .. } => self.walk_all(value),
            ExprKind::Jsx(jsx) => self.walk_jsx_element(jsx),
            ExprKind::Dot { obj: inner, .. }
            | ExprKind::Unary { operand: inner, .. }
            | ExprKind::Await(inner)
            | ExprKind::Spread(inner)
            | ExprKind::As { expr: inner, .. }
            | ExprKind::Satisfies { expr: inner, .. }
            | ExprKind::AsConst(inner)
            | ExprKind::NonNull(inner)
            | ExprKind::Instantiation { expr: inner, .. } => self.walk(inner),
            _ => {}
        }
    }

    fn walk_object_property(&mut self, prop: Prop<'a>) {
        self.walk_all(computed_key(prop.key()));
        match prop.func() {
            // A method or accessor isn't queued itself, and it isn't a boundary for `memo` / `forwardRef` context.
            Some(func) => {
                self.walk_formal_parameters(func);
                self.walk_all(func.body_statements().into_iter().flatten());
            }
            None => self.walk_all(prop.value()),
        }
    }

    /// Also oxc's `walk_jsx_children` and `walk_jsx_container`.
    fn walk_jsx_element(&mut self, jsx: Jsx<'a>) {
        self.walk_all(jsx.attrs().iter().filter_map(Prop::value));
        self.walk_all(jsx.children());
    }
}

/// Find all functions in the program that should be compiled.
fn find_functions_to_compile<'a>(file: &'a File<'a>, search: Search<'a>) -> Vec<CompileSource<'a>> {
    let mut walker = DiscoveryWalker::new(search);
    walker.walk_program(file);
    walker.queue
}

/// A function is queued because of a directive, a hook call or JSX. Returns false if the file has none of these, or if
/// the plugin never gets to compile it.
pub(crate) fn may_have_react_code(file: &File, flavor: Flavor) -> bool {
    let has_react_code = file.mentions_hook_name()
        || file.has_exprs([ExprTag::Jsx])
        || file.mentions_any(&OPT_IN_DIRECTIVES);
    let path = file.path();
    has_react_code
        && match flavor {
            Flavor::Oxlint => true,
            // The plugin's `sources` option. It also parses the whole text as a program, and in these files the scripts
            // are only a part of the text.
            Flavor::Eslint => {
                !strings::contains(path, b"node_modules")
                    && ![".vue", ".svelte", ".astro"]
                        .iter()
                        .any(|extension| path.ends_with(extension.as_bytes()))
            }
        }
}

/// The plugin's `mayContainReactCode`, without which it does nothing. It only looks at top-level statements, so it
/// misses a file whose components are all nested, wrapped in `memo()` or opted in by a directive.
fn may_contain_react_code<'a>(file: &'a File<'a>) -> bool {
    let is_name = |name: Name<'a>| is_component_name(name.bytes()) || is_hook_name(name.bytes());
    file.body().iter().any(|node| match node.kind() {
        // Without a body it's a `TSDeclareFunction`.
        StmtKind::Fn(func) if func.has_body() => match func.name() {
            Some(id) => is_name(id.name()),
            None => true,
        },
        StmtKind::Var(declarations) => declarations.iter().any(|decl| {
            decl.init().is_some_and(|init| init.tag() == ExprTag::Fn)
                && get_declarator_name(decl).is_some_and(is_name)
        }),
        StmtKind::ExportDefault(declaration) => declaration.tag() == ExprTag::Fn,
        _ => false,
    })
}

/// Cheap, sound pre-check for [`find_functions_to_compile`]: `false` means the discovery walk cannot queue anything.
/// Over-approximation is fine (the walk then finds an empty queue); a missed witness is not.
fn may_have_functions_to_compile<'a>(file: &'a File<'a>, search: &mut Search<'a>) -> bool {
    let flavor = search.flavor;
    if !may_have_react_code(file, flavor) {
        return false;
    }

    // forwardRef/memo wrappers. Discovery matches callee names, not bindings.
    let is_wrapper_call = |call: Expr<'a>| {
        call.callee()
            .is_some_and(|callee| get_callee_name_if_react_api(callee, flavor).is_some())
    };
    if file.mentions_any(&["memo", "forwardRef"])
        && file.exprs_of_kind(ExprTag::Call).any(is_wrapper_call)
    {
        return true;
    }

    // Named components/hooks and directive opt-ins, with the name that discovery would infer.
    file.funcs().any(|func| {
        let name = match func.kind() {
            FnKind::Decl => func.name().map(Ident::name),
            FnKind::Expr | FnKind::Arrow => declarator_name_for(func),
            _ => return false,
        };
        try_make_compile_source(func, name, None, search).is_some()
    })
}

/// The `const Foo = <fn>` name for a function expression or an arrow function.
fn declarator_name_for(func: Func<'_>) -> Option<Name<'_>> {
    match func.owner().parent() {
        Node::VarDecl(decl) => get_declarator_name(decl),
        _ => None,
    }
}

// ───────────────────────────── the second parse ─────────────────────────────

/// The plugin doesn't compile ESLint's tree. It parses the text again, a `.ts` or `.tsx` file with Babel and its
/// `typescript` and `jsx` plugins, anything else with hermes-parser, and reports nothing if that throws.
///
/// This covers the syntax that a valid program can have and these parsers reject: @babel/parser 7.29, hermes-parser
/// 0.25. TypeScript-only syntax, which hermes-parser gets in a `.mts` or `.cts` file and reads as Flow, is only partly
/// covered.
fn second_parser_rejects<'a>(file: &'a File<'a>) -> bool {
    #[derive(Copy, Clone, PartialEq, Eq)]
    enum Parser {
        Babel,
        Hermes,
    }
    let path = file.path();
    let parser = match path.ends_with(b".ts") || path.ends_with(b".tsx") {
        true => Parser::Babel,
        false => Parser::Hermes,
    };

    let rejected_modifiers = match parser {
        Parser::Babel => Flags::ACCESSOR,
        Parser::Hermes => {
            Flags::ACCESSOR
                | Flags::ABSTRACT
                | Flags::READONLY
                | Flags::OPTIONAL
                | Flags::DEFINITE
                | Flags::PRIVATE
                | Flags::PROTECTED
                | Flags::PUBLIC
                | Flags::OVERRIDE
        }
    };
    let rejects_class = |class: Class<'a>| {
        class.decorators().next().is_some()
            || class.flags().intersects(rejected_modifiers)
            || class.members().iter().any(|member| {
                member.decorators().next().is_some()
                    || member.flags().intersects(rejected_modifiers)
                    || (parser == Parser::Hermes && member.kind() == MemberKind::StaticBlock)
                    || member.func().is_some_and(|func| {
                        (func.params().iter()).any(|param| param.decorators().next().is_some())
                    })
            })
    };
    if file.has_classes() && file.classes().any(rejects_class) {
        return true;
    }

    // Babel accepts `with { .. }` after a module specifier but not the older `assert { .. }`. hermes-parser is the
    // other way round.
    let rejected_keyword: &[u8] = match parser {
        Parser::Babel => b"assert",
        Parser::Hermes => b"with",
    };
    let is_rejected_name = |name: Ident<'a>| parser == Parser::Hermes && name.is_string();
    let rejects_import_or_export = |stmt: Stmt<'a>| {
        (stmt.import_attributes())
            .is_some_and(|attributes| file.slice(attributes.keyword_span()) == rejected_keyword)
            || match stmt.kind() {
                StmtKind::Import(import) => {
                    import.phase().is_some()
                        || (import.named().iter()).any(|it| is_rejected_name(it.imported()))
                }
                StmtKind::ExportNamed(export) => (export.items().iter())
                    .any(|it| is_rejected_name(it.local()) || is_rejected_name(it.exported())),
                StmtKind::ExportStar { alias, .. } => alias.is_some_and(is_rejected_name),
                _ => false,
            }
    };
    if file.body().iter().any(rejects_import_or_export) {
        return true;
    }

    let is_outermost = |func: &Func<'a>| func.has_body() && func.enclosing().is_none();
    let mut outermost: Vec<Span> = file.funcs().filter(is_outermost).map(Func::span).collect();
    outermost.sort_unstable();
    let is_outside_functions = |at: Span| {
        let after = outermost.partition_point(|span| span.start <= at.start);
        let before = after.checked_sub(1).and_then(|it| outermost.get(it));
        before.is_none_or(|span| span.end <= at.start)
    };

    // With `jsx`, a `<` where an expression starts is an element or the type parameters of an arrow function.
    if (file
        .exprs_of_kind(ExprTag::As)
        .chain(file.exprs_of_kind(ExprTag::AsConst)))
    .any(Expr::is_angle_bracket_assertion)
        || (file.stmts_of_kind(StmtTag::Return)).any(|it| is_outside_functions(it.span()))
    {
        return true;
    }
    if parser == Parser::Babel {
        return false;
    }

    let is_using = |stmt: Stmt<'a>| match stmt.kind() {
        StmtKind::Var(declarations) => declarations
            .first()
            .is_some_and(|it| matches!(it.var_kind(), VarKind::Using | VarKind::AwaitUsing)),
        _ => false,
    };
    // `a=<b />`
    let is_attribute_without_braces = |element: Expr<'a>| {
        matches!(element.parent(), Node::Prop(attribute) if attribute.is_jsx_attribute())
            && element.jsx_container_span().is_none()
    };
    let awaits_in_no_function = |stmt: Stmt<'a>| {
        matches!(stmt.kind(), StmtKind::ForOf { is_await: true, .. })
            && is_outside_functions(stmt.span())
    };
    let has_type_arguments = |expr: Expr<'a>| {
        expr.as_call_like()
            .is_some_and(|call| !call.type_args().is_empty())
    };
    (file.mentions("using") && file.stmts_of_kind(StmtTag::Var).any(is_using))
        || file
            .exprs_of_kind(ExprTag::Jsx)
            .any(is_attribute_without_braces)
        || (file.exprs_of_kind(ExprTag::Await)).any(|it| is_outside_functions(it.span()))
        || file
            .stmts_of_kind(StmtTag::ForOf)
            .any(awaits_in_no_function)
        || (!file.is_javascript()
            && (file.has_exprs([ExprTag::NonNull, ExprTag::Satisfies, ExprTag::Instantiation])
                || file.has_stmts([
                    StmtTag::ImportEquals,
                    StmtTag::ExportAssign,
                    StmtTag::ExportAsNamespace,
                    StmtTag::Module,
                ])
                || file.exprs_of_kind(ExprTag::New).any(has_type_arguments)))
}

// ───────────────────────────── the file ─────────────────────────────

/// True if the program already imports the `c` memo-cache helper from `module_name`, which means the file has already
/// been compiled and must be skipped. The plugin also counts a type-only import, and one inside a `declare module`.
fn has_memo_cache_function_import<'a>(
    file: &'a File<'a>,
    module_name: &str,
    flavor: Flavor,
) -> bool {
    let skips_types = flavor == Flavor::Oxlint;
    let imports_it = |stmt: Stmt<'a>| match stmt.kind() {
        StmtKind::Import(import) => {
            import.spec().is(module_name)
                && !(skips_types && import.is_type_only())
                && import.named().iter().any(|specifier| {
                    !(skips_types && specifier.is_type_only())
                        && specifier.imported().name().is("c")
                })
        }
        _ => false,
    };
    file.mentions(module_name)
        && match flavor {
            Flavor::Oxlint => file.body().iter().any(imports_it),
            Flavor::Eslint => file.stmts_of_kind(StmtTag::Import).any(imports_it),
        }
}

/// oxc's `lint()`, i.e. `run_compiler` and `compile_program`: all of the file's diagnostics, in oxc's order. For
/// [`Flavor::Eslint`], the `CompileError` events from the plugin's `runReactCompiler` that its rules don't drop because
/// of a comment.
///
/// A `"use no memo"` at the top of the file has no effect when nothing is emitted.
pub(crate) fn compile_program<'a>(
    file: &'a File<'a>,
    flavor: Flavor,
    wanted: Categories,
) -> Vec<Finding> {
    if has_memo_cache_function_import(file, REACT_COMPILER_RUNTIME_MODULE, flavor) {
        return Vec::new();
    }

    let mut search = Search::new(flavor);
    if !may_have_functions_to_compile(file, &mut search)
        || (flavor == Flavor::Eslint && !may_contain_react_code(file))
    {
        return Vec::new();
    }
    let queue = find_functions_to_compile(file, search);
    if queue.is_empty() || (flavor == Flavor::Eslint && second_parser_rejects(file)) {
        return Vec::new();
    }

    let mut context = ProgramContext {
        flavor,
        compiler: Compiler::new(file, flavor, wanted),
        // The plugin validates hooks and memoization dependencies itself, and in that mode the compiler doesn't look
        // for suppression comments.
        suppressions: match flavor {
            Flavor::Oxlint => find_program_suppressions(file, &ESLINT_SUPPRESSION_RULES),
            Flavor::Eslint => ProgramSuppressions::default(),
        },
        diagnostics: Vec::new(),
    };
    for source in &queue {
        if process_fn(source, &mut context).is_err() {
            break;
        }
    }
    if flavor == Flavor::Eslint {
        remove_flow_suppressed(file, &mut context.diagnostics);
    }
    context.diagnostics
}
