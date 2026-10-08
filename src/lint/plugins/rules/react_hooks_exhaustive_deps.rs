use crate::oxlint;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};

/// Verifies the list of dependencies for Hooks like useEffect and similar.
pub struct ExhaustiveDeps {
    additional_hooks: Option<Regex>,
    enable_dangerous_autofix_this_may_cause_infinite_loops: bool,
    experimental_auto_dependencies_hooks: Vec<Box<[u8]>>,
    require_explicit_effect_deps: bool,
}

/// Upstream has no ids, and puts its messages together.
const TEXT: Message = Message::new("", "{{text}}");

/// The first element of the pattern in `const [state, setState] = useState()`.
#[derive(Copy, Clone)]
enum StateVariable<'a> {
    /// A hole.
    Missing,
    Ident(Name<'a>),
    Other,
}

#[derive(Default)]
pub struct State<'a> {
    /// The calls of hooks that take dependencies.
    calls: Vec<Expr<'a>>,
    /// `settings["react-hooks"].additionalEffectHooks`
    additional_hooks: Option<Regex>,
    /// What follows is kept from one call to the next. An identifier is told by where it starts.
    set_state_call_sites: FxHashMap<u32, StateVariable<'a>>,
    state_variables: FxHashSet<u32>,
    use_effect_event_variables: FxHashSet<u32>,
    stable_known_value_cache: FxHashMap<usize, bool>,
    function_without_captured_value_cache: FxHashMap<usize, bool>,
}

struct Dependency<'a> {
    key: Vec<u8>,
    is_stable: bool,
    references: Vec<Reference<'a>>,
}

struct DeclaredDependency {
    key: Vec<u8>,
}

/// A change that is suggested: what describes it, and the fixes that make it.
type Suggested = (Vec<u8>, Vec<Fix>);

fn text(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

fn join(items: &[Vec<u8>], separator: &[u8]) -> Vec<u8> {
    items.join(separator)
}

fn join_english(items: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, item) in items.iter().enumerate() {
        out.extend_from_slice(item);
        if i == 0 && items.len() == 2 {
            out.extend_from_slice(b" and ");
        } else if i + 2 == items.len() && items.len() > 2 {
            out.extend_from_slice(b", and ");
        } else if i + 1 < items.len() {
            out.extend_from_slice(b", ");
        }
    }
    out
}

/// Without the `as T` around it.
fn without_as(mut e: Expr) -> Expr {
    loop {
        match e.kind() {
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr) if !e.is_angle_bracket_assertion() => e = expr,
            _ => return e,
        }
    }
}

/// `MemberExpression`
fn is_member_expression(e: Expr) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index) && !e.is_jsx_tag_name() && !e.is_in_type_query()
}

/// The `MemberExpression` that is the parent of `e`.
fn parent_member(e: Expr) -> Option<Expr> {
    match e.parent() {
        Node::Expr(parent) if !e.is_chain_root() && is_member_expression(parent) => Some(parent),
        _ => None,
    }
}

/// `e.parent` is a call and `e` is what it calls.
fn is_callee(e: Expr) -> bool {
    match e.parent() {
        Node::Expr(parent) if !e.is_chain_root() => matches!(parent.kind(), ExprKind::Call(call) if call.callee() == e),
        _ => false,
    }
}

/// `e.parent` is an `AssignmentExpression` and `e` is its left side.
fn is_left_of_assignment(e: Expr) -> bool {
    match e.parent() {
        Node::Expr(parent) if !e.is_chain_root() => {
            matches!(parent.kind(), ExprKind::Assign { target, .. } if target == e) && !parent.is_assignment_target()
        }
        _ => false,
    }
}

/// `e.current`, where `e` is the object.
fn current_of(e: Expr) -> Option<Ident> {
    match parent_member(e)?.kind() {
        ExprKind::Dot { obj, name, .. } if obj == e && name.name().is("current") => Some(name),
        _ => None,
    }
}

/// With `()` for what is passed and returned:
/// `(props)` is `(props)`, `(props).foo` is `(props.foo)`, `(props).foo.bar` is `(props.foo.bar)`.
fn get_dependency(mut node: Expr) -> Expr {
    loop {
        if let Some(parent) = parent_member(node)
            && let ExprKind::Dot { obj, name, .. } = parent.kind()
            && obj == node
            && !name.name().is("current")
            && !name.bytes().starts_with(b"#")
            && !is_callee(parent)
        {
            node = parent;
            continue;
        }
        return match node.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if is_left_of_assignment(node) => obj,
            _ => node,
        };
    }
}

type OptionalChains = FxHashMap<Vec<u8>, bool>;

/// `foo` is `foo`, `foo.bar` is `foo.bar`, `foo?.bar.baz` is `foo.bar.baz`. `None` where upstream throws.
fn analyze_property_chain(node: Expr, mut optional_chains: Option<&mut OptionalChains>) -> Option<Vec<u8>> {
    let (object, property, is_optional) = match node.kind() {
        ExprKind::Ident(name) => {
            if let Some(chains) = optional_chains {
                chains.insert(name.bytes().to_vec(), false);
            }
            return Some(name.bytes().to_vec());
        }
        ExprKind::Dot { obj, name, chain } if !name.bytes().starts_with(b"#") => (obj, name.bytes().to_vec(), chain == Chain::Start),
        // Upstream does not look at `computed` of what is in a `ChainExpression`.
        ExprKind::Index { obj, index, chain } if node.is_chain_root() => {
            (obj, analyze_property_chain(index, None)?, chain == Chain::Start)
        }
        _ => return None,
    };
    let mut result = analyze_property_chain(object, optional_chains.as_deref_mut())?;
    result.push(b'.');
    result.extend_from_slice(&property);
    if let Some(chains) = optional_chains {
        // It is optional only if all its uses are.
        if is_optional {
            chains.entry(result.clone()).or_insert(true);
        } else {
            chains.insert(result.clone(), false);
        }
    }
    Some(result)
}

/// The name of the hook that `callee` is, and whether it is written `React.name`.
/// It is a name, or a member of a name: what nearly every other call is told from by two loads.
fn may_be_hook(callee: Expr) -> bool {
    match callee.tag() {
        ExprTag::Ident => true,
        ExprTag::Dot => matches!(callee.kind(), ExprKind::Dot { obj, .. } if obj.tag() == ExprTag::Ident),
        _ => false,
    }
}

fn hook_name(callee: Expr) -> Option<(Name, bool)> {
    match callee.kind() {
        ExprKind::Ident(name) => Some((name, false)),
        ExprKind::Dot { obj, name, .. } if obj.is_ident("React") && !name.bytes().starts_with(b"#") => Some((name.name(), true)),
        _ => None,
    }
}

/// `/Effect($|[^a-z])/.test(name)`
fn is_effect_name(name: &[u8]) -> bool {
    let mut rest = name;
    while let Some(at) = strings::index_of(rest, b"Effect") {
        rest = &rest[at + 6..];
        if !rest.first().is_some_and(u8::is_ascii_lowercase) {
            return true;
        }
    }
    false
}

/// What kind of value, which is a new one each time, the expression makes.
fn get_construction_expression_type(e: Expr) -> Option<&'static str> {
    let is_construction = |e: Expr| get_construction_expression_type(e).is_some();
    match e.kind() {
        ExprKind::Object(_) => Some("object"),
        ExprKind::Array(_) => Some("array"),
        ExprKind::Fn(_) => Some("function"),
        ExprKind::Class(_) => Some("class"),
        ExprKind::Cond { yes, no, .. } => (is_construction(yes) || is_construction(no)).then_some("conditional"),
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish,
            left,
            right,
        } => (is_construction(left) || is_construction(right)).then_some("logical expression"),
        ExprKind::Jsx(jsx) => Some(if jsx.is_fragment() { "JSX fragment" } else { "JSX element" }),
        ExprKind::Assign { value, .. } => is_construction(value).then_some("assignment expression"),
        ExprKind::New(_) => Some("object construction"),
        ExprKind::Regex(_) => Some("regular expression"),
        ExprKind::As { expr, .. } | ExprKind::AsConst(expr) if !e.is_angle_bracket_assertion() => {
            get_construction_expression_type(expr)
        }
        _ => None,
    }
}

// ───────────────────────────── collectRecommendations ─────────────────────────────

#[derive(Default)]
struct DepTreeNode {
    /// It is used in the code.
    is_used: bool,
    /// It is among the dependencies.
    is_satisfied_recursively: bool,
    /// Something deeper is used in the code.
    is_subtree_used: bool,
    /// In the order in which they are added.
    children: Vec<(Vec<u8>, usize)>,
}

struct DepTree {
    nodes: Vec<DepTreeNode>,
}

impl DepTree {
    fn get_or_create_node_by_path(&mut self, path: &[u8], mut on_the_way: impl FnMut(&mut DepTreeNode)) -> usize {
        let mut at = 0;
        for key in strings::split(path, b".") {
            at = match self.nodes[at].children.iter().find(|it| it.0 == key) {
                Some(child) => child.1,
                None => {
                    let child = self.nodes.len();
                    self.nodes.push(DepTreeNode::default());
                    self.nodes[at].children.push((key.to_vec(), child));
                    child
                }
            };
            on_the_way(&mut self.nodes[at]);
        }
        at
    }

    fn scan(&self, at: usize, prefix: &[u8], missing: &mut Vec<Vec<u8>>, satisfying: &mut Vec<Vec<u8>>) {
        for (key, child) in &self.nodes[at].children {
            let path = if prefix.is_empty() { key.clone() } else { text(&[prefix, b".", key]) };
            let child_node = &self.nodes[*child];
            if child_node.is_satisfied_recursively {
                if child_node.is_subtree_used {
                    satisfying.push(path);
                }
            } else if child_node.is_used {
                missing.push(path);
            } else {
                self.scan(*child, &path, missing, satisfying);
            }
        }
    }
}

struct Recommendations {
    suggested: Vec<Vec<u8>>,
    unnecessary: Vec<Vec<u8>>,
    duplicate: Vec<Vec<u8>>,
    missing: Vec<Vec<u8>>,
}

fn add(set: &mut Vec<Vec<u8>>, key: &[u8]) {
    if !set.iter().any(|it| it == key) {
        set.push(key.to_vec());
    }
}

fn has(set: &[Vec<u8>], key: &[u8]) -> bool {
    set.iter().any(|it| it == key)
}

fn collect_recommendations(
    dependencies: &[Dependency],
    declared: &[DeclaredDependency],
    stable: &[Vec<u8>],
    external: &[Vec<u8>],
    is_effect: bool,
) -> Recommendations {
    let mut tree = DepTree {
        nodes: vec![DepTreeNode::default()],
    };
    for dependency in dependencies {
        let node = tree.get_or_create_node_by_path(&dependency.key, |it| it.is_subtree_used = true);
        tree.nodes[node].is_used = true;
    }
    for key in declared.iter().map(|it| &it.key).chain(stable) {
        let node = tree.get_or_create_node_by_path(key, |_| {});
        tree.nodes[node].is_satisfied_recursively = true;
    }
    let (mut missing, mut satisfying) = (Vec::new(), Vec::new());
    tree.scan(0, b"", &mut missing, &mut satisfying);

    let (mut suggested, mut unnecessary, mut duplicate) = (Vec::new(), Vec::new(), Vec::new());
    for DeclaredDependency { key } in declared {
        if has(&satisfying, key) {
            if has(&suggested, key) {
                add(&mut duplicate, key);
            } else {
                suggested.push(key.clone());
            }
        } else if is_effect && !key.ends_with(b".current") && !has(external, key) {
            // An effect may have more dependencies than it uses.
            add(&mut suggested, key);
        } else {
            add(&mut unnecessary, key);
        }
    }
    suggested.extend(missing.iter().cloned());
    Recommendations {
        suggested,
        unnecessary,
        duplicate,
        missing,
    }
}

// ───────────────────────────── the rule ─────────────────────────────

impl Rule for ExhaustiveDeps {
    const META: Meta = Meta::plugin(Plugin::ReactHooks, "exhaustive-deps", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .recommended();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        ExhaustiveDeps {
            additional_hooks: options.str("additionalHooks").filter(|it| !it.is_empty()).and_then(|it| Regex::new(it, "").ok()),
            enable_dangerous_autofix_this_may_cause_infinite_loops: options
                .bool_or("enableDangerousAutofixThisMayCauseInfiniteLoops", false),
            experimental_auto_dependencies_hooks: (options.strings("experimental_autoDependenciesHooks").iter())
                .map(|it| it.as_bytes().into())
                .collect(),
            require_explicit_effect_deps: options.bool_or("requireExplicitEffectDeps", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        let from_settings = || {
            let pattern = file.settings().get(b"react-hooks")?.get(b"additionalEffectHooks")?.as_str()?;
            Regex::from_bytes(pattern, b"").ok()
        };
        let follows_oxlint = oxlint::is_followed(file);
        let additional_hooks = if self.additional_hooks.is_none() && !follows_oxlint { from_settings() } else { None };
        if self.additional_hooks.is_none()
            && additional_hooks.is_none()
            && !file.mentions_any(&["useEffect", "useLayoutEffect", "useCallback", "useMemo", "useImperativeHandle"])
        {
            return State::default();
        }
        if follows_oxlint {
            on.exprs([ExprTag::Call], |rule, e, cx| {
                if e.as_call().is_some_and(|it| may_be_hook(it.callee())) {
                    oxlint::exhaustive_deps::run(cx, e, rule.additional_hooks.as_ref());
                }
            });
            return State::default();
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            if let Some(call) = e.as_call()
                && may_be_hook(call.callee())
                && rule.get_reactive_hook_callback_index(call.callee(), &cx.state).is_some()
            {
                cx.state.calls.push(e);
            }
        });
        on.finish(|rule, cx| {
            // What is learned from one call is used for the next ones.
            let mut calls = std::mem::take(&mut cx.state.calls);
            calls.sort_unstable_by_key(|it| (it.span().start, std::cmp::Reverse(it.span().end)));
            for call in calls {
                rule.visit_call_expression(call, cx);
            }
        });
        State {
            additional_hooks,
            ..State::default()
        }
    }
}

/// What is the same for all of `visitFunctionWithDependencies`.
struct Visit<'a> {
    /// `scopeManager.acquire(node)`
    scope: Scope<'a>,
    /// The scopes around it, up to that of the component.
    pure_scopes: Vec<Scope<'a>>,
    component_scope: Scope<'a>,
}

impl<'a> Visit<'a> {
    fn is_pure(&self, scope: Scope<'a>) -> bool {
        self.pure_scopes.contains(&scope)
    }
}

/// The `VariableDeclarator` that is `defs[0].node`, and the identifier in it that declares the variable.
fn declarator_of(symbol: Symbol) -> Option<(VarDecl, Pat)> {
    match symbol.declarations().next()? {
        declaration @ Declaration::Var(pat) if !declaration.is_catch_parameter() => match declaration.node()? {
            Node::VarDecl(declarator) => Some((declarator, pat)),
            _ => None,
        },
        _ => None,
    }
}

impl ExhaustiveDeps {
    /// At which position a hook takes the function with the dependencies. `None` if it is not such a hook.
    fn get_reactive_hook_callback_index(&self, callee: Expr, state: &State) -> Option<usize> {
        let (name, is_in_namespace) = hook_name(callee)?;
        match name.bytes() {
            b"useEffect" | b"useLayoutEffect" | b"useCallback" | b"useMemo" => Some(0),
            b"useImperativeHandle" => Some(1),
            name if !is_in_namespace => {
                let additional_hooks = self.additional_hooks.as_ref().or(state.additional_hooks.as_ref())?;
                additional_hooks.test(name).then_some(0)
            }
            _ => None,
        }
    }

    fn report_problem<'a>(&self, cx: &Cx<'a, Self>, at: impl Spanned, message: Vec<u8>, suggestion: Option<Suggested>) {
        let mut report = cx.report(at, TEXT).data("text", message);
        if let Some((description, fixes)) = suggestion {
            if self.enable_dangerous_autofix_this_may_cause_infinite_loops {
                report = report.fix(|_| fixes.clone());
            }
            report = report.suggest_with(TEXT, &[("text", &description)], |_| fixes);
        }
        drop(report);
    }

    fn visit_call_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = node.kind() else {
            return;
        };
        let reactive_hook = call.callee();
        let Some(callback_index) = self.get_reactive_hook_callback_index(reactive_hook, &cx.state) else {
            return;
        };
        let Some((name, _)) = hook_name(reactive_hook) else {
            return;
        };
        let reactive_hook_name = name.bytes();
        let maybe_node = call.args().get(callback_index + 1);
        let declared_dependencies_node = maybe_node.filter(|it| !it.is_ident("undefined"));
        let is_effect = is_effect_name(reactive_hook_name);

        let Some(callback) = call.args().get(callback_index) else {
            let message = text(&[
                b"React Hook ",
                reactive_hook_name,
                b" requires an effect callback. Did you forget to pass a callback to the hook?",
            ]);
            return self.report_problem(cx, reactive_hook, message, None);
        };
        if maybe_node.is_none() && is_effect && self.require_explicit_effect_deps {
            let message = text(&[
                b"React Hook ",
                reactive_hook_name,
                b" always requires dependencies. Please add a dependency array or an explicit `undefined`",
            ]);
            self.report_problem(cx, reactive_hook, message, None);
        }
        let is_auto_deps_hook = self.experimental_auto_dependencies_hooks.iter().any(|it| **it == *reactive_hook_name);
        let has_no_dependencies = match declared_dependencies_node {
            Some(it) => is_auto_deps_hook && it.tag() == ExprTag::Null,
            None => true,
        };
        if has_no_dependencies && !is_effect {
            if matches!(reactive_hook_name, b"useMemo" | b"useCallback") {
                let message = text(&[
                    b"React Hook ",
                    reactive_hook_name,
                    b" does nothing when called with only one argument. Did you forget to pass an array of dependencies?",
                ]);
                self.report_problem(cx, reactive_hook, message, None);
            }
            return;
        }

        let unknown_dependencies = || {
            text(&[
                b"React Hook ",
                reactive_hook_name,
                b" received a function whose dependencies are unknown. Pass an inline function instead.",
            ])
        };
        let callback = without_as(callback);
        let function = match callback.kind() {
            ExprKind::Fn(func) => Some(func),
            ExprKind::Ident(callback_name) => {
                let Some(declared) = declared_dependencies_node.filter(|_| !has_no_dependencies) else {
                    return;
                };
                if let ExprKind::Array(elements) = declared.kind()
                    && elements.iter().any(|it| it.as_ident() == Some(callback_name))
                {
                    return;
                }
                let Some(variable) = Node::Expr(callback).scope().get_name(callback_name) else {
                    return;
                };
                match variable.declarations().next() {
                    Some(Declaration::Param(_)) => return self.report_problem(cx, reactive_hook, unknown_dependencies(), None),
                    Some(Declaration::Fn(func)) if func.kind() == FnKind::Decl && func.has_body() => Some(func),
                    Some(Declaration::Var(_)) => declarator_of(variable).and_then(|it| it.0.init()?.as_fn()),
                    _ => None,
                }
            }
            _ => return self.report_problem(cx, reactive_hook, unknown_dependencies(), None),
        };
        if let Some(function) = function {
            return self.visit_function_with_dependencies(
                function,
                declared_dependencies_node,
                reactive_hook,
                reactive_hook_name,
                is_effect,
                is_auto_deps_hook,
                cx,
            );
        }
        // Something unusual: suggest the function itself as a dependency.
        let (Some(callback_name), Some(declared)) = (callback.as_ident(), declared_dependencies_node) else {
            return;
        };
        let message = text(&[
            b"React Hook ",
            reactive_hook_name,
            b" has a missing dependency: '",
            callback_name.bytes(),
            b"'. Either include it or remove the dependency array.",
        ]);
        let array = text(&[b"[", callback_name.bytes(), b"]"]);
        let fix = Fix {
            span: declared.span(),
            text: array.clone(),
        };
        let description = text(&[b"Update the dependencies array to be: ", &array]);
        self.report_problem(cx, reactive_hook, message, Some((description, vec![fix])));
    }

    /// `const [state, setState] = useState()`, `const ref = useRef()` and the like: what React returns the same each time.
    fn is_stable_known_hook_value<'a>(resolved: Symbol<'a>, state: &mut State<'a>) -> bool {
        if let Some(&known) = state.stable_known_value_cache.get(&resolved.key()) {
            return known;
        }
        let result = Self::compute_is_stable_known_hook_value(resolved, state);
        state.stable_known_value_cache.insert(resolved.key(), result);
        result
    }

    fn compute_is_stable_known_hook_value<'a>(resolved: Symbol<'a>, state: &mut State<'a>) -> bool {
        let Some((declarator, identifier)) = declarator_of(resolved) else {
            return false;
        };
        let Some(init) = declarator.init().map(without_as) else {
            return false;
        };
        if declarator.var_kind() == VarKind::Const && matches!(init.tag(), ExprTag::String | ExprTag::Number | ExprTag::Null) {
            return true;
        }
        let ExprKind::Call(call) = init.kind() else {
            return false;
        };
        if init.is_chain_root() {
            return false;
        }
        let Some((name, _)) = hook_name(call.callee()) else {
            return false;
        };
        let id = declarator.pat();
        // The elements, if it is `[a, b]`. An element is the variable if it is nothing but its name.
        let pair = match id.kind() {
            PatKind::Array(elements) if elements.len() == 2 => elements.first().zip(elements.last()),
            _ => None,
        };
        let is_the_variable = |element: PatElem<'a>| {
            element.pat() == Some(identifier) && element.default().is_none() && !element.is_rest()
        };
        match name.bytes() {
            b"useRef" if id.tag() == PatTag::Ident => true,
            b"useEffectEvent" if id.tag() == PatTag::Ident => {
                state.use_effect_event_variables.extend(resolved.references().map(|it| it.span().start));
                true
            }
            b"useState" | b"useReducer" | b"useActionState" => {
                let Some((first, second)) = pair else {
                    return false;
                };
                if is_the_variable(second) {
                    if name.is("useState") {
                        let state_variable = match first.pat() {
                            None => StateVariable::Missing,
                            Some(pat) => match pat.as_ident() {
                                Some(name) if first.default().is_none() && !first.is_rest() => StateVariable::Ident(name),
                                _ => StateVariable::Other,
                            },
                        };
                        let mut write_count = 0;
                        for reference in resolved.references() {
                            write_count += u32::from(reference.is_write());
                            if write_count > 1 {
                                return false;
                            }
                            state.set_state_call_sites.insert(reference.span().start, state_variable);
                        }
                    }
                    return true;
                }
                if is_the_variable(first) && name.is("useState") {
                    state.state_variables.extend(resolved.references().map(|it| it.span().start));
                }
                false
            }
            b"useTransition" => pair.is_some_and(|it| is_the_variable(it.1)),
            _ => false,
        }
    }

    /// A function of the component that refers to nothing that changes.
    fn is_function_without_captured_values<'a>(resolved: Symbol<'a>, visit: &Visit<'a>, state: &mut State<'a>) -> bool {
        if let Some(&known) = state.function_without_captured_value_cache.get(&resolved.key()) {
            return known;
        }
        let result = Self::compute_is_function_without_captured_values(resolved, visit, state);
        state.function_without_captured_value_cache.insert(resolved.key(), result);
        result
    }

    fn compute_is_function_without_captured_values<'a>(resolved: Symbol<'a>, visit: &Visit<'a>, state: &mut State<'a>) -> bool {
        // The node of the scope that is looked for among those directly in the component.
        let block = match resolved.declarations().next() {
            Some(Declaration::Fn(func)) if func.kind() == FnKind::Decl && func.has_body() => Node::Func(func),
            Some(Declaration::Var(_)) => match declarator_of(resolved).and_then(|it| it.0.init()).map(Expr::kind) {
                Some(ExprKind::Fn(func)) => Node::Func(func),
                Some(ExprKind::Class(class)) => Node::Class(class),
                _ => return false,
            },
            _ => return false,
        };
        let Some(function_scope) = visit.component_scope.children().find(|it| it.node() == block) else {
            return false;
        };
        for reference in function_scope.through() {
            if let Some(symbol) = reference.symbol()
                && visit.is_pure(symbol.scope())
                && !Self::is_stable_known_hook_value(symbol, state)
            {
                return false;
            }
        }
        true
    }

    fn visit_function_with_dependencies<'a>(
        &self,
        node: Func<'a>,
        declared_dependencies_node: Option<Expr<'a>>,
        reactive_hook: Expr<'a>,
        reactive_hook_name: &'a [u8],
        is_effect: bool,
        is_auto_deps_hook: bool,
        cx: &mut Cx<'a, Self>,
    ) {
        if is_effect && node.is_async() {
            let message = b"Effect callbacks are synchronous to prevent race conditions. Put the async function inside:\n\n\
useEffect(() => {\n  async function fetchData() {\n    // You can await here\n    const response = await MyAPI.getData(someId);\n    // ...\n  }\n  fetchData();\n\
}, [someId]); // Or [] if effect doesn't need props or state\n\n\
Learn more about data fetching with Hooks: https://react.dev/link/hooks-data-fetching";
            self.report_problem(cx, node.estree_span(), message.to_vec(), None);
        }
        let Some(function_scope) = node.scope() else {
            return;
        };
        // For a function expression with a name, ESLint answers with the scope of the name.
        let scope = match function_scope.parent() {
            Some(parent) if parent.kind() == ScopeKind::FunctionExpressionName => parent,
            _ => function_scope,
        };
        let mut pure_scopes = Vec::new();
        let mut component_scope = None;
        for current in scope.chain().skip(1) {
            pure_scopes.push(current);
            if current.kind() == ScopeKind::Function {
                component_scope = Some(current);
                break;
            }
        }
        let Some(component_scope) = component_scope else {
            return;
        };
        let visit = Visit {
            scope,
            pure_scopes,
            component_scope,
        };
        let hook_text = reactive_hook.text();

        let mut dependencies: Vec<Dependency<'a>> = Vec::new();
        let mut optional_chains = OptionalChains::default();
        // `ref.current` in the function that an effect returns.
        let mut current_refs_in_effect_cleanup: Vec<(Vec<u8>, Reference<'a>, Ident<'a>)> = Vec::new();
        let callback_parent = match node.owner() {
            Node::Expr(e) => e.parent().as_expr(),
            _ => None,
        };
        let mut scopes = vec![scope];
        while let Some(current) = scopes.pop() {
            for reference in current.references() {
                let Some(resolved) = reference.symbol().filter(|it| visit.is_pure(it.scope())) else {
                    continue;
                };
                let Some(reference_node) = reference.expr() else {
                    continue;
                };
                let dependency_node = get_dependency(reference_node);
                let Some(dependency) = analyze_property_chain(dependency_node, Some(&mut optional_chains)) else {
                    continue;
                };
                if is_effect
                    && dependency_node.tag() == ExprTag::Ident
                    && !dependency_node.is_jsx_tag_name()
                    && let Some(current_name) = current_of(dependency_node)
                    && is_inside_effect_cleanup(reference, node)
                {
                    match current_refs_in_effect_cleanup.iter_mut().find(|it| it.0 == dependency) {
                        Some(existing) => (existing.1, existing.2) = (reference, current_name),
                        None => current_refs_in_effect_cleanup.push((dependency.clone(), reference, current_name)),
                    }
                }
                // `typeof a` in a type.
                if matches!(dependency_node.parent(), Node::Type(_)) {
                    continue;
                }
                // The function itself, which is not defined yet.
                if callback_parent.is_some() && declarator_of(resolved).and_then(|it| it.0.init()) == callback_parent {
                    continue;
                }
                if resolved.declarations().next().is_none() {
                    continue;
                }
                match dependencies.iter_mut().find(|it| it.key == dependency) {
                    Some(existing) => existing.references.push(reference),
                    None => dependencies.push(Dependency {
                        key: dependency,
                        is_stable: Self::is_stable_known_hook_value(resolved, &mut cx.state)
                            || Self::is_function_without_captured_values(resolved, &visit, &mut cx.state),
                        references: vec![reference],
                    }),
                }
            }
            let at = scopes.len();
            scopes.extend(current.children());
            scopes[at..].reverse();
        }

        for (dependency, reference, current_name) in &current_refs_in_effect_cleanup {
            // Whether React sets the ref, or the code does.
            let found_current_assignment = reference.symbol().is_some_and(|symbol| {
                symbol.references().any(|it| {
                    it.expr().is_some_and(|e| current_of(e).is_some() && parent_member(e).is_some_and(is_left_of_assignment))
                })
            });
            if found_current_assignment {
                continue;
            }
            let message = text(&[
                b"The ref value '",
                dependency,
                b".current' will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by React, copy '",
                dependency,
                b".current' to a variable inside the effect, and use that variable in the cleanup function.",
            ]);
            self.report_problem(cx, current_name, message, None);
        }

        // Assignments to variables of the component are lost.
        let mut has_stale_assignments = false;
        let mut stable_dependencies: Vec<Vec<u8>> = Vec::new();
        for dependency in &dependencies {
            if dependency.is_stable {
                stable_dependencies.push(dependency.key.clone());
            }
            if let Some(write_expr) = dependency.references.iter().find_map(|it| it.write_expr()) {
                has_stale_assignments = true;
                let message = text(&[
                    b"Assignments to the '",
                    &dependency.key,
                    b"' variable from inside React Hook ",
                    hook_text,
                    b" will be lost after each render. To preserve the value over time, store it in a useRef Hook and keep the mutable value in the '.current' property. Otherwise, you can move this variable directly inside ",
                    hook_text,
                    b".",
                ]);
                self.report_problem(cx, write_expr, message, None);
            }
        }
        if has_stale_assignments {
            return;
        }

        let Some(declared_dependencies_node) = declared_dependencies_node else {
            if is_auto_deps_hook {
                return;
            }
            // A call of `setState` directly in an effect without dependencies tends to loop.
            let set_state_inside_effect_without_deps = dependencies.iter().find(|dependency| {
                dependency.references.iter().any(|reference| {
                    cx.state.set_state_call_sites.contains_key(&reference.span().start)
                        && (reference.scope().chain().find(|it| it.kind() == ScopeKind::Function))
                            .is_some_and(|it| it.node() == Node::Func(node))
                })
            });
            if let Some(dependency) = set_state_inside_effect_without_deps {
                let suggested = collect_recommendations(&dependencies, &[], &stable_dependencies, &[], true).suggested;
                let list = join(&suggested, b", ");
                let message = text(&[
                    b"React Hook ",
                    reactive_hook_name,
                    b" contains a call to '",
                    &dependency.key,
                    b"'. Without a list of dependencies, this can lead to an infinite chain of updates. To fix this, pass [",
                    &list,
                    b"] as a second argument to the ",
                    reactive_hook_name,
                    b" Hook.",
                ]);
                let fix = Fix {
                    span: Span::empty(node.estree_span().end),
                    text: text(&[b", [", &list, b"]"]),
                };
                let description = text(&[b"Add dependencies array: [", &list, b"]"]);
                self.report_problem(cx, reactive_hook, message, Some((description, vec![fix])));
            }
            return;
        };
        if is_auto_deps_hook && declared_dependencies_node.tag() == ExprTag::Null {
            return;
        }

        let mut declared_dependencies: Vec<DeclaredDependency> = Vec::new();
        let mut external_dependencies: Vec<Vec<u8>> = Vec::new();
        let array = match declared_dependencies_node.kind() {
            ExprKind::Array(elements) => Some(elements),
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr) if !declared_dependencies_node.is_angle_bracket_assertion() => {
                match expr.kind() {
                    ExprKind::Array(elements) => Some(elements),
                    _ => None,
                }
            }
            _ => None,
        };
        if array.is_none() {
            let message = text(&[
                b"React Hook ",
                hook_text,
                b" was passed a dependency list that is not an array literal. This means we can't statically verify whether you've passed the correct dependencies.",
            ]);
            self.report_problem(cx, declared_dependencies_node, message, None);
        }
        for declared in array.into_iter().flatten() {
            if declared.is_missing() {
                continue;
            }
            if declared.tag() == ExprTag::Spread {
                let message = text(&[
                    b"React Hook ",
                    hook_text,
                    b" has a spread element in its dependency array. This means we can't statically verify whether you've passed the correct dependencies.",
                ]);
                self.report_problem(cx, declared, message, None);
                continue;
            }
            if declared.tag() == ExprTag::Ident && cx.state.use_effect_event_variables.contains(&declared.span().start) {
                let message = text(&[
                    b"Functions returned from `useEffectEvent` must not be included in the dependency array. Remove `",
                    declared.text(),
                    b"` from the list.",
                ]);
                let fix = Fix {
                    span: declared.span(),
                    text: Vec::new(),
                };
                let description = text(&[b"Remove the dependency `", declared.text(), b"`"]);
                self.report_problem(cx, declared, message, Some((description, vec![fix])));
            }
            let Some(key) = analyze_property_chain(declared, None) else {
                let is_literal = matches!(
                    declared.tag(),
                    ExprTag::String | ExprTag::Number | ExprTag::BigInt | ExprTag::True | ExprTag::False | ExprTag::Null | ExprTag::Regex
                );
                let message = match declared.as_string() {
                    Some(value) if !value.bytes().is_empty() && dependencies.iter().any(|it| it.key == value.bytes()) => text(&[
                        b"The ",
                        declared.text(),
                        b" literal is not a valid dependency because it never changes. Did you mean to include ",
                        value.bytes(),
                        b" in the array instead?",
                    ]),
                    _ if is_literal => text(&[
                        b"The ",
                        declared.text(),
                        b" literal is not a valid dependency because it never changes. You can safely remove it.",
                    ]),
                    _ => text(&[
                        b"React Hook ",
                        hook_text,
                        b" has a complex expression in the dependency array. Extract it to a separate variable so it can be statically checked.",
                    ]),
                };
                self.report_problem(cx, declared, message, None);
                continue;
            };
            let mut maybe_id = declared;
            while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = maybe_id.kind() {
                maybe_id = obj;
            }
            let is_declared_in_component = match maybe_id.reference() {
                Some(reference) => reference.symbol().is_some_and(|it| component_scope.contains(it.scope())),
                None => true,
            };
            if !is_declared_in_component {
                add(&mut external_dependencies, &key);
            }
            declared_dependencies.push(DeclaredDependency { key });
        }

        let Recommendations {
            suggested,
            unnecessary,
            duplicate,
            missing,
        } = collect_recommendations(&dependencies, &declared_dependencies, &stable_dependencies, &external_dependencies, is_effect);
        let mut suggested_deps = suggested;

        if duplicate.len() + missing.len() + unnecessary.len() == 0 {
            // Dependencies that are new on every render.
            return self.report_constructions(&visit, &declared_dependencies, declared_dependencies_node, reactive_hook_name, cx);
        }

        // An effect can have reasons for more dependencies than it uses, nothing else has.
        if !is_effect && !missing.is_empty() {
            suggested_deps = collect_recommendations(&dependencies, &[], &stable_dependencies, &external_dependencies, is_effect).suggested;
        }
        if declared_dependencies.is_sorted_by(|a, b| a.key <= b.key) {
            suggested_deps.sort();
        }

        // `?.` where all uses of a member are optional.
        let format_dependency = |path: &[u8]| {
            let mut out = Vec::with_capacity(path.len() + 2);
            let mut end = 0;
            for (i, member) in strings::split(path, b".").enumerate() {
                end += member.len() + usize::from(i != 0);
                if i != 0 {
                    let is_optional = optional_chains.get(&path[..end]) == Some(&true);
                    out.extend_from_slice(if is_optional { b"?." } else { b"." });
                }
                out.extend_from_slice(member);
            }
            out
        };
        let get_warning_message = |deps: &[Vec<u8>], single_prefix: &str, label: &str, fix_verb: &str| {
            if deps.is_empty() {
                return None;
            }
            let is_many = deps.len() > 1;
            let mut sorted = deps.to_vec();
            sorted.sort();
            let quoted: Vec<Vec<u8>> = sorted.iter().map(|it| text(&[b"'", &format_dependency(it), b"'"])).collect();
            Some(text(&[
                if is_many { b"" } else { single_prefix.as_bytes() },
                if is_many { b"" } else { b" " },
                label.as_bytes(),
                if is_many { b" dependencies: " } else { b" dependency: " },
                &join_english(&quoted),
                b". Either ",
                fix_verb.as_bytes(),
                if is_many { b" them" } else { b" it" },
                b" or remove the dependency array.",
            ]))
        };

        let mut extra_warning = Vec::new();
        if !unnecessary.is_empty() {
            if let Some(bad_ref) = unnecessary.iter().find(|it| it.ends_with(b".current")) {
                extra_warning = text(&[
                    b" Mutable values like '",
                    bad_ref,
                    b"' aren't valid dependencies because mutating them doesn't re-render the component.",
                ]);
            } else if let Some(dep) = external_dependencies.first()
                // Not for what has just been moved into the function.
                && scope.get_bytes(dep).is_none()
            {
                extra_warning = text(&[
                    b" Outer scope values like '",
                    dep,
                    b"' aren't valid dependencies because mutating them doesn't re-render the component.",
                ]);
            }
        }

        // `props.foo()` makes `props` a dependency, as it is the `this` of the call.
        if extra_warning.is_empty()
            && has(&missing, b"props")
            && let Some(props) = dependencies.iter().find(|it| it.key == b"props")
            && props.references.iter().all(|it| it.expr().is_some_and(|e| parent_member(e).is_some()))
        {
            extra_warning = text(&[
                b" However, 'props' will change when *any* prop changes, so the preferred fix is to destructure the 'props' object outside of the ",
                reactive_hook_name,
                b" call and refer to those specific props inside ",
                hook_text,
                b".",
            ]);
        }

        if extra_warning.is_empty() {
            // A prop that is called and left out: its author may not know `useCallback`.
            let missing_callback_dep = missing.iter().find(|missing_dep| {
                let top_scope_ref = component_scope.get_bytes(missing_dep);
                let Some(used_dep) = dependencies.iter().find(|it| it.key == **missing_dep) else {
                    return false;
                };
                used_dep.references.first().and_then(|it| it.symbol()) == top_scope_ref
                    && matches!(top_scope_ref.and_then(|it| it.declarations().next()), Some(Declaration::Param(_)))
                    && used_dep.references.iter().any(|it| it.expr().is_some_and(is_callee))
            });
            if let Some(dep) = missing_callback_dep {
                extra_warning = text(&[
                    b" If '",
                    dep,
                    b"' changes too often, find the parent component that defines it and wrap that definition in useCallback.",
                ]);
            }
        }

        if extra_warning.is_empty() {
            extra_warning = set_state_recommendation(&missing, &dependencies, component_scope, &cx.state).unwrap_or_default();
        }

        let Some(warning) = get_warning_message(&missing, "a", "missing", "include")
            .or_else(|| get_warning_message(&unnecessary, "an", "unnecessary", "exclude"))
            .or_else(|| get_warning_message(&duplicate, "a", "duplicate", "omit"))
        else {
            return;
        };
        let formatted: Vec<Vec<u8>> = suggested_deps.iter().map(|it| format_dependency(it)).collect();
        let array = text(&[b"[", &join(&formatted, b", "), b"]"]);
        let fix = Fix {
            span: declared_dependencies_node.span(),
            text: array.clone(),
        };
        let description = text(&[b"Update the dependencies array to be: ", &array]);
        let message = text(&[b"React Hook ", hook_text, b" has ", &warning, &extra_warning]);
        self.report_problem(cx, declared_dependencies_node, message, Some((description, vec![fix])));
    }

    /// `scanForConstructions`, and what is reported about them.
    fn report_constructions<'a>(
        &self,
        visit: &Visit<'a>,
        declared_dependencies: &[DeclaredDependency],
        declared_dependencies_node: Expr<'a>,
        reactive_hook_name: &[u8],
        cx: &Cx<'a, Self>,
    ) {
        for DeclaredDependency { key } in declared_dependencies {
            let Some(variable) = visit.component_scope.get_bytes(key) else {
                continue;
            };
            let (construction, dep_type, init): (Span, _, _) = match variable.declarations().next() {
                Some(Declaration::Var(_)) => {
                    let Some((declarator, _)) = declarator_of(variable).filter(|it| it.0.pat().tag() == PatTag::Ident) else {
                        continue;
                    };
                    let Some((init, dep_type)) = declarator.init().and_then(|it| Some((it, get_construction_expression_type(it)?)))
                    else {
                        continue;
                    };
                    (declarator.span(), dep_type, Some(init))
                }
                Some(Declaration::Fn(func)) if func.kind() == FnKind::Decl && func.has_body() => (func.estree_span(), "function", None),
                Some(Declaration::Class(class)) if matches!(class.owner(), Node::Stmt(_)) => (class.estree_span(), "class", None),
                _ => continue,
            };
            let is_used_outside_of_hook = is_used_outside_of_hook(variable, visit.scope, declared_dependencies_node);
            let (wrapper_hook, construction_type) = match dep_type {
                "function" => ("useCallback", "definition"),
                _ => ("useMemo", "initialization"),
            };
            let default_advice = text(&[
                b"rap the ",
                construction_type.as_bytes(),
                b" of '",
                key,
                b"' in its own ",
                wrapper_hook.as_bytes(),
                b"() Hook.",
            ]);
            let advice = match is_used_outside_of_hook {
                true => text(&[b"To fix this, w", &default_advice]),
                false => text(&[b"Move it inside the ", reactive_hook_name, b" callback. Alternatively, w", &default_advice]),
            };
            let causation: &[u8] = match dep_type {
                "conditional" | "logical expression" => b"could make",
                _ => b"makes",
            };
            let line = cx.line_of(declared_dependencies_node.span().start).to_string();
            let message = text(&[
                b"The '",
                key,
                b"' ",
                dep_type.as_bytes(),
                b" ",
                causation,
                b" the dependencies of ",
                reactive_hook_name,
                b" Hook (at line ",
                line.as_bytes(),
                b") change on every render. ",
                &advice,
            ]);
            // Only a function in a variable: an object may be changed later, and a declaration is hoisted.
            let suggestion = init.filter(|_| is_used_outside_of_hook && dep_type == "function").map(|init| {
                let fixes = vec![
                    Fix {
                        span: Span::empty(init.span().start),
                        text: b"useCallback(".to_vec(),
                    },
                    Fix {
                        span: Span::empty(init.span().end),
                        text: b")".to_vec(),
                    },
                ];
                (text(&[b"W", &default_advice]), fixes)
            });
            self.report_problem(cx, construction, message, suggestion);
        }
    }
}

/// Whether the outermost function around the reference, inside the effect, is what the effect returns.
fn is_inside_effect_cleanup<'a>(reference: Reference<'a>, effect: Func<'a>) -> bool {
    let mut is_in_returned_function = false;
    for scope in reference.scope().chain().take_while(|it| it.node() != Node::Func(effect)) {
        if scope.kind() == ScopeKind::Function
            && let Node::Func(func) = scope.node()
        {
            is_in_returned_function = match func.owner() {
                Node::Expr(e) => matches!(e.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Return),
                _ => false,
            };
        }
    }
    is_in_returned_function
}

fn is_used_outside_of_hook<'a>(variable: Symbol<'a>, scope: Scope<'a>, declared_dependencies_node: Expr<'a>) -> bool {
    // ESLint has another variable for the name of a class inside the class.
    let own_scope = match variable.declarations().next() {
        Some(Declaration::Class(class)) => class.scope(),
        _ => None,
    };
    let mut found_write_expr = false;
    for reference in variable.references() {
        if own_scope.is_some_and(|it| it.contains(reference.scope())) {
            continue;
        }
        if reference.write_expr().is_some() {
            if found_write_expr {
                return true;
            }
            // The first is not a use.
            found_write_expr = true;
            continue;
        }
        if !scope.contains(reference.scope()) && !declared_dependencies_node.span().contains(reference.span()) {
            return true;
        }
    }
    false
}

/// What to say about `setState(something(missingDep))`.
fn set_state_recommendation<'a>(
    missing: &[Vec<u8>],
    dependencies: &[Dependency<'a>],
    component_scope: Scope<'a>,
    state: &State<'a>,
) -> Option<Vec<u8>> {
    let component = component_scope.node();
    for missing_dep in missing {
        let used_dep = dependencies.iter().find(|it| it.key == *missing_dep)?;
        for reference in &used_dep.references {
            let Some(id) = reference.expr() else {
                continue;
            };
            for maybe_call in Node::Expr(id).ancestors().take_while(|it| *it != component) {
                let Node::Expr(e) = maybe_call else {
                    continue;
                };
                let ExprKind::Call(call) = e.kind() else {
                    continue;
                };
                let Some(setter) = call.callee().as_ident() else {
                    continue;
                };
                let setter = setter.bytes();
                let state_variable = match state.set_state_call_sites.get(&call.callee().span().start) {
                    None | Some(StateVariable::Missing) => continue,
                    Some(&it) => it,
                };
                if matches!(state_variable, StateVariable::Ident(name) if name.bytes() == &missing_dep[..]) {
                    // `setCount(count + 1)`
                    let length = match missing_dep.first() {
                        Some(0xF0..) => 4,
                        Some(0xE0..) => 3,
                        Some(0xC0..) => 2,
                        _ => 1,
                    };
                    let first = missing_dep.get(..length).unwrap_or(missing_dep);
                    return Some(text(&[
                        b" You can also do a functional update '",
                        setter,
                        b"(",
                        first,
                        b" => ...)' if you only need '",
                        missing_dep,
                        b"' in the '",
                        setter,
                        b"' call.",
                    ]));
                }
                if state.state_variables.contains(&id.span().start) {
                    // `setCount(count + increment)`
                    return Some(text(&[
                        b" You can also replace multiple useState variables with useReducer if '",
                        setter,
                        b"' needs the current value of '",
                        missing_dep,
                        b"'.",
                    ]));
                }
                // A parameter that is missing is a prop, or something in one.
                if matches!(reference.symbol().and_then(|it| it.declarations().next()), Some(Declaration::Param(_))) {
                    return Some(text(&[
                        b" If '",
                        setter,
                        b"' needs the current value of '",
                        missing_dep,
                        b"', you can also switch to useReducer instead of useState and read '",
                        missing_dep,
                        b"' in the reducer.",
                    ]));
                }
                break;
            }
        }
    }
    None
}
