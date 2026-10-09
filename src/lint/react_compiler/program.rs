//! Which functions of a file the compiler is run on, and what becomes of what it says of them: what `oxc_react_compiler::lint()`
//! does around its pipeline (`lib.rs`, `react_compiler/entrypoint/program.rs`, `imports.rs`), function by function and under the
//! same names.
//!
//! The options are those of oxlint, which are fixed: `compilation_mode: infer`, `panic_threshold: none`, `target: 19`, the output
//! mode `lint`, no gating, no directives of its own, no imports that are forbidden. What only another value of these can
//! reach is left out.
//!
//! Nothing here calls itself: what oxc walks by recursion is a list of what is left to walk.

use crate::compile::{Compiler, Depth};
use crate::finding::Finding;
use crate::suppression::{
    ProgramSuppressions, find_program_suppressions, suppressions_to_diagnostics,
};
use bun_core::strings;
use bun_lint::ast::{
    Call, Chain, Expr, ExprKind, ExprTag, File, FnBody, FnKind, Func, Ident, Jsx, Key, KeyKind,
    Keyword, List, Name, Node, Pat, PatKind, Prop, PropKind, Stmt, StmtKind, StmtTag, TypeKind,
    TypeNode, UnOp, VarDecl,
};
use bun_lint::span::Span;
use bun_react_compiler::diagnostics::ErrorCategory;
use bun_react_compiler::hir::ReactFunctionType;

/// oxlint's `eslint_suppression_rules`: the defaults of the compiler, and how oxlint spells the same rules.
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

/// After this many diagnostics no other function is compiled. Each function is reported for each comment that suppresses it, which
/// is more than there is memory for in a file that has many of both.
const MAX_DIAGNOSTICS: usize = 1 << 16;

/// A function found in the program that should be compiled.
struct CompileSource<'a> {
    fn_type: ReactFunctionType,
    fn_node: Func<'a>,
}

// ───────────────────────────── directives ─────────────────────────────

/// The values of the strings that the body of the function starts with.
fn body_directive_values<'a>(func: Func<'a>) -> impl Iterator<Item = Name<'a>> {
    let statements = func.body_statements().into_iter().flatten();
    statements.map_while(|statement| match statement.kind() {
        StmtKind::Expr(expression) if !expression.is_parenthesized() => expression.as_string(),
        _ => None,
    })
}

fn try_find_directive_enabling_memoization(func: Func<'_>) -> bool {
    body_directive_values(func).any(|directive| directive.is_any(&OPT_IN_DIRECTIVES))
}

fn find_directive_disabling_memoization(func: Func<'_>) -> bool {
    body_directive_values(func).any(|directive| directive.is_any(&OPT_OUT_DIRECTIVES))
}

// ───────────────────────────── names ─────────────────────────────

/// Check if a string follows the React hook naming convention (use[A-Z0-9]...).
fn is_hook_name(s: &[u8]) -> bool {
    matches!(s, [b'u', b's', b'e', c, ..] if c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// Check if a name looks like a React component (starts with uppercase letter).
fn is_component_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_uppercase)
}

/// Check if an expression is a hook call (identifier with hook name, or member expression `PascalCase.useHook`). Parentheses
/// are nodes for oxc, which does not look into them here.
fn expr_is_hook(expr: Expr<'_>) -> bool {
    if expr.is_parenthesized() {
        return false;
    }
    match expr.kind() {
        ExprKind::Ident(name) => is_hook_name(name.bytes()),
        ExprKind::Dot { obj, name, .. } => {
            is_hook_name(name.bytes())
                && !obj.is_parenthesized()
                && obj
                    .as_ident()
                    .is_some_and(|obj| is_component_name(obj.bytes()))
        }
        _ => false,
    }
}

/// Whether neither the call nor its callee has a `?.`. oxc's `expr_contains_optional` stops at parentheses and at `!`, which
/// makes no difference for a callee that [`expr_is_hook`] accepts.
fn is_regular_call(call: Call<'_>) -> bool {
    call.chain() == Chain::No
}

// ───────────────────────────── what a function returns and calls ─────────────────────────────

/// Check if an expression is a "non-node" return value (indicating the function is not a React component).
fn is_non_node(expr: Expr<'_>) -> bool {
    matches!(
        expr.tag(),
        ExprTag::Object | ExprTag::Fn | ExprTag::BigInt | ExprTag::Class | ExprTag::New
    )
}

/// Check if a function returns non-node values. oxc's `returns_non_node_in_stmts` visits the `return` statements of the function
/// in the order of the source, and the last one that it visits decides.
fn returns_non_node_fn(func: Func<'_>) -> bool {
    if let FnBody::Expr(expr) = func.body() {
        return is_non_node(expr);
    }
    let last = func
        .returns()
        .max_by_key(|statement| statement.span().start);
    last.is_some_and(|statement| match statement.kind() {
        StmtKind::Return(Some(arg)) => is_non_node(arg),
        _ => true,
    })
}

/// The search of `calls_hooks_or_creates_jsx`: what is yet to be looked at, in no particular order.
#[derive(Default)]
struct Search<'a> {
    pending: Vec<Node<'a>>,
}

impl<'a> Search<'a> {
    fn look(&mut self, node: impl Into<Node<'a>>) {
        self.pending.push(node.into());
    }

    fn look_all<T: Into<Node<'a>>>(&mut self, nodes: impl IntoIterator<Item = T>) {
        self.pending.extend(nodes.into_iter().map(Into::into));
    }

    /// Check if a function calls hooks or creates JSX, in its parameters or its body, not in nested functions.
    fn calls_hooks_or_creates_jsx(&mut self, func: Func<'a>) -> bool {
        self.pending.clear();
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
            // Nested functions, classes, and what only TypeScript has.
            _ => {}
        }
    }

    /// Whether `expr` itself is JSX or the call of a hook. What is in it is left to be looked at.
    fn calls_hooks_or_creates_jsx_in_expr(&mut self, expr: Expr<'a>) -> bool {
        match expr.kind() {
            ExprKind::Jsx(_) => return true,
            ExprKind::Call(call) => {
                if is_regular_call(call) && expr_is_hook(call.callee()) {
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
                        // The keys are not looked at, nor the parameters of a method.
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
            // Nested functions, classes, `import()`, and what has nothing in it.
            _ => {}
        }
        false
    }

    /// The defaults of the parameters, and those in their patterns.
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

/// Check if a parameter's type annotation is valid for a React component prop. Returns false for primitive type annotations
/// that indicate this is NOT a component. A type in parentheses is a node of its own for oxc, which is not among them.
fn is_valid_props_annotation(type_annotation: Option<TypeNode<'_>>) -> bool {
    let Some(annotation) = type_annotation else {
        return true;
    };
    let is_primitive = matches!(
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
fn is_valid_component_params(func: Func<'_>) -> bool {
    let params = func.params();
    let Some(first) = params.first() else {
        return true;
    };
    if params.len() > 2 || first.is_rest() || !is_valid_props_annotation(first.ty()) {
        return false;
    }
    let Some(second) = params.get(1) else {
        return true;
    };
    !second.is_rest()
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
    match try_find_directive_enabling_memoization(func) {
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
            let is_component = is_valid_component_params(func)
                && !returns_non_node_fn(func)
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
/// Not through parentheses.
fn get_callee_name_if_react_api(callee: Expr<'_>) -> Option<Name<'_>> {
    const NAMES: [&str; 2] = ["forwardRef", "memo"];
    if callee.is_parenthesized() {
        return None;
    }
    match callee.kind() {
        ExprKind::Ident(name) => name.is_any(&NAMES).then_some(name),
        ExprKind::Dot { obj, name, .. } => {
            (name.name().is_any(&NAMES) && obj.is_ident("React") && !obj.is_parenthesized())
                .then(|| name.name())
        }
        _ => None,
    }
}

// ───────────────────────────── errors ─────────────────────────────

/// oxc's `FunctionNode::diagnostic_span`: the name of the function if it has one of its own, otherwise its head, to the `{` of
/// the body or to where the expression starts that is the body.
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

/// Push a failed compilation attempt's diagnostics onto the accumulator. oxc's `with_fallback_label` is left to who renders them.
fn log_error(err: Vec<Finding>, fn_span: Span, diagnostics: &mut Vec<Finding>) {
    diagnostics.extend(err.into_iter().map(|diagnostic| Finding {
        function_span: Some(fn_span),
        ..diagnostic
    }));
}

/// With `panic_threshold: none`, only an error in the configuration is one that ends the run.
fn should_panic(diagnostics: &[Finding]) -> bool {
    diagnostics
        .iter()
        .any(|diagnostic| diagnostic.category == ErrorCategory::Config)
}

/// oxc's `CompileResult::Fatal`: no other function is compiled. What has been said so far is reported all the same.
struct Fatal;

fn handle_error(
    err: Vec<Finding>,
    fn_span: Span,
    diagnostics: &mut Vec<Finding>,
) -> Result<(), Fatal> {
    let is_fatal = should_panic(&err);
    log_error(err, fn_span, diagnostics);
    if is_fatal { Err(Fatal) } else { Ok(()) }
}

// ───────────────────────────── one function ─────────────────────────────

/// What of oxc's `ProgramContext` is used where nothing is emitted.
struct ProgramContext<'a> {
    compiler: Compiler<'a>,
    suppressions: ProgramSuppressions<'a>,
    diagnostics: Vec<Finding>,
}

/// Attempt to compile a single function. `Err`: the diagnostics of the failed attempt.
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

/// Process a single function: check directives, attempt compilation, handle results. Where nothing is emitted, all that
/// `"use no memo"` changes is that an error in the configuration does not end the run: what the compiler says of the function is
/// reported like that of any other.
fn process_fn<'a>(
    source: &CompileSource<'a>,
    context: &mut ProgramContext<'a>,
) -> Result<(), Fatal> {
    let diagnostic_span = diagnostic_span(source.fn_node);
    let opt_out = find_directive_disabling_memoization(source.fn_node);

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

/// The expression of a key that is computed from more than a literal.
fn computed_key(key: Option<Key<'_>>) -> Option<Expr<'_>> {
    match key?.kind() {
        KeyKind::Computed(expression) => Some(expression),
        _ => None,
    }
}

/// What a [`DiscoveryWalker`] does next.
enum Step<'a> {
    /// A statement, an expression or a binding pattern.
    Walk(Node<'a>),
    /// A function that is the initializer of a declarator, and the name of that.
    WalkFunction(Func<'a>, Option<Name<'a>>),
    PopParentCallee,
}

/// Walks the file to find compilable functions, in the order of the source.
///
/// Compiled functions have their bodies skipped. Other functions are descended to find nested components and hooks. Not walked:
/// classes, namespaces, enums, `export =`, `import()`, the targets of assignments and of `for`-`in` and `for`-`of`, and the
/// patterns of declarators and of `catch`.
struct DiscoveryWalker<'a> {
    search: Search<'a>,
    queue: Vec<CompileSource<'a>>,
    /// For each call and each function around what is walked: the name if it is a call of `memo` or `forwardRef`.
    parent_callee_stack: Vec<Option<Name<'a>>>,
    /// The next is the last.
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

    /// After what has been added in this step.
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
            // The name is that of a function which is all of the initializer, in parentheses or not.
            match init.as_fn() {
                Some(func) => self
                    .steps
                    .push(Step::WalkFunction(func, get_declarator_name(declarator))),
                None => self.walk(init),
            }
        }
    }

    /// oxc's `walk_function` and `walk_arrow`. `inferred_name`: the name from the enclosing variable declarator. A function
    /// declaration has its own name, a function expression never.
    fn walk_function(&mut self, func: Func<'a>, inferred_name: Option<Name<'a>>) {
        let name = match func.kind() {
            FnKind::Decl => func.name().map(Ident::name),
            _ => inferred_name,
        };
        let parent_callee = self.current_parent_callee();
        if let Some(source) = try_make_compile_source(func, name, parent_callee, &mut self.search) {
            self.queue.push(source);
            return;
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
                // oxc's `walk_chain_element`: the call that is the whole of an optional chain says nothing of its arguments, which
                // are taken for those of the call around it.
                let is_chain_element = call.chain() != Chain::No && expr.is_chain_root();
                if !is_chain_element {
                    self.parent_callee_stack
                        .push(get_callee_name_if_react_api(call.callee()));
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
            // A method or an accessor is not queued itself, and is no boundary for `memo` / `forwardRef` context.
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

/// Cheap, sound pre-check for [`find_functions_to_compile`]: `false` means the discovery walk cannot queue anything.
/// Over-approximation is fine (the walk then finds an empty queue); a missed witness is not.
fn may_have_functions_to_compile<'a>(file: &'a File<'a>, search: &mut Search<'a>) -> bool {
    // A function is queued for a directive, or for a hook that it calls or JSX that it creates.
    if !file.mentions_name_of_hook()
        && !file.has_exprs([ExprTag::Jsx])
        && !file.mentions_any(&OPT_IN_DIRECTIVES)
    {
        return false;
    }

    // forwardRef/memo wrappers. Discovery matches the names of callees, not bindings.
    let is_wrapper_call = |call: Expr<'a>| {
        call.callee()
            .is_some_and(|callee| get_callee_name_if_react_api(callee).is_some())
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

// ───────────────────────────── the file ─────────────────────────────

/// Whether the program already imports the `c` memo-cache helper from `module_name`: the file has already been compiled and must
/// be skipped.
fn has_memo_cache_function_import<'a>(file: &'a File<'a>, module_name: &str) -> bool {
    file.mentions(module_name)
        && file.body().iter().any(|stmt| match stmt.kind() {
            StmtKind::Import(import) => {
                import.spec().is(module_name)
                    && !import.is_type_only()
                    && import.named().iter().any(|specifier| {
                        !specifier.is_type_only() && specifier.imported().name().is("c")
                    })
            }
            _ => false,
        })
}

/// oxc's `lint()`: all diagnostics of the file, in oxc's order. That is `run_compiler` and `compile_program`.
///
/// A `"use no memo"` at the top of the file changes nothing where nothing is emitted.
pub(crate) fn compile_program<'a>(file: &'a File<'a>, depth: Depth) -> Vec<Finding> {
    if has_memo_cache_function_import(file, REACT_COMPILER_RUNTIME_MODULE) {
        return Vec::new();
    }

    let mut search = Search::default();
    if !may_have_functions_to_compile(file, &mut search) {
        return Vec::new();
    }
    let queue = find_functions_to_compile(file, search);
    if queue.is_empty() {
        return Vec::new();
    }

    let mut context = ProgramContext {
        compiler: Compiler::new(file, depth),
        suppressions: find_program_suppressions(file, &ESLINT_SUPPRESSION_RULES),
        diagnostics: Vec::new(),
    };
    for source in &queue {
        if process_fn(source, &mut context).is_err() || context.diagnostics.len() >= MAX_DIAGNOSTICS
        {
            break;
        }
    }
    context.diagnostics
}
