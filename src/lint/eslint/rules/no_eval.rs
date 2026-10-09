use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow the use of `eval()`.
pub struct NoEval {
    allows_indirect: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "`eval` can be harmful.");

/// What is known about the `this` of a file.
#[derive(Default)]
pub struct Known<'a> {
    /// Whether a `this` at a node, in a function or in a field of a class, is the global object.
    at: AncestorMemo<'a, bool>,
    /// The same directly in a function.
    in_function: FxHashMap<Func<'a>, bool>,
    bindings: ast_utils::ThisBindingMemo<'a>,
    /// Whether oxc takes the file for a module.
    is_module: Option<bool>,
}

/// `e` is a member access of the property `name`.
fn is_member(e: Expr<'_>, name: &str) -> bool {
    ast_utils::is_specific_member_access(e, None, Some(name))
}

/// The identifier refers to the variable of its name in the global scope, which the configuration
/// defines or a script declares.
fn refers_to_global_variable(e: Expr<'_>) -> bool {
    let Some(reference) = e.reference() else {
        return false;
    };
    match reference.symbol() {
        Some(symbol) => symbol.scope().kind() == ScopeKind::Global,
        None => ast_utils::is_configured_global(e.file(), reference.name().bytes()),
    }
}

impl NoEval {
    /// Reports the `eval` of `object.eval` or `object["eval"]`.
    fn report_member<'a>(member: Expr<'a>, cx: &Cx<'a, Self>) {
        if !ast_utils::is_member_expression(member) {
            return;
        }
        match member.kind() {
            ExprKind::Dot { name, .. } => cx.report(name, UNEXPECTED),
            ExprKind::Index { index, .. } => cx.report(index, UNEXPECTED),
            _ => return,
        };
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // `eval?.("code")` is not a direct call.
        if let Some(call) = e.as_call()
            && call.callee().is_ident("eval")
            && !(self.allows_indirect && call.is_optional())
        {
            cx.report(call.callee(), UNEXPECTED);
        }
    }

    /// `eval` that is not called, and `eval` as a property of the global object.
    fn check_identifier<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = e.as_ident() else {
            return;
        };
        let global_object = match name.bytes() {
            b"eval" => {
                if !ast_utils::is_callee(e) && refers_to_global_variable(e) {
                    cx.report(e, UNEXPECTED);
                }
                return;
            }
            b"global" => "global",
            b"window" => "window",
            b"globalThis" => "globalThis",
            _ => return,
        };
        let Node::Expr(mut member) = e.parent() else {
            return;
        };
        // `window.window.eval`
        while is_member(member, global_object) {
            let Node::Expr(parent) = member.parent() else {
                return;
            };
            member = parent;
        }
        if is_member(member, "eval") && refers_to_global_variable(e) {
            Self::report_member(member, cx);
        }
    }

    /// `this.eval` where `this` is the global object.
    fn check_this<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(member) = e.parent() else {
            return;
        };
        if !is_member(member, "eval") {
            return;
        }
        let (file, is_oxlint) = (cx.file(), cx.language().is_oxlint);
        if is_oxlint {
            let is_module = || utils::oxlint::source_type(file) == SourceType::Module;
            // For oxc parentheses are nodes: `(this).eval` is no property of `this`.
            if *cx.state.is_module.get_or_insert_with(is_module) || e.is_parenthesized() {
                return;
            }
        }
        let is_strict = |scope: Scope<'a>| match is_oxlint {
            true => scope.chain().any(utils::oxlint::makes_strict),
            false => scope.is_strict(),
        };
        let Known { at, in_function, bindings, .. } = &mut cx.state;
        let is_global_object = at.find(Node::Expr(e), |child, ancestor| match ancestor {
            Node::Func(func) if !func.is_arrow() => Some(*in_function.entry(func).or_insert_with(|| {
                // oxlint takes a function for a constructor by its own name alone, and knows the capitals of ASCII.
                let is_ascii = |it: Ident<'a>| it.bytes().first().is_some_and(u8::is_ascii);
                let cap_is_constructor = !is_oxlint || func.name().is_some_and(is_ascii);
                !func.scope().is_none_or(is_strict)
                    && ast_utils::is_default_this_binding_with(func, cap_is_constructor, bindings)
            })),
            // In the initializer of a field it is the instance or the class.
            Node::Member(field)
                if field.kind() == MemberKind::Property
                    && (is_oxlint || !field.flags().contains(Flags::ACCESSOR))
                    && field.init().map(Node::Expr) == Some(child) =>
            {
                Some(false)
            }
            Node::Stmt(namespace) if is_oxlint && namespace.tag() == StmtTag::Module => Some(false),
            _ => None,
        });
        if let Some(is_global_object) = is_global_object {
            if is_global_object {
                Self::report_member(member, cx);
            }
            return;
        }
        // For oxlint it is the global object at the top of a script and of CommonJS, also below `"use strict"`.
        if is_oxlint {
            Self::report_member(member, cx);
            return;
        }

        let language = cx.language();
        let is_module = language.scope_source_type() == SourceType::Module;
        let is_top_level_of_script = !is_module && !language.global_return;
        if is_top_level_of_script
            || !(is_module || file.scope().is_strict() || file.top_level_scope().is_strict())
        {
            Self::report_member(member, cx);
        }
    }
}

impl Rule for NoEval {
    const META: Meta = Meta::eslint("no-eval", Kind::Suggestion);
    type State<'a> = Known<'a>;

    fn new(options: &Options) -> Self {
        NoEval {
            allows_indirect: options.object(0).bool_or("allowIndirect", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !file.mentions("eval") {
            return Known::default();
        }
        on.exprs([ExprTag::Call], Self::check_call);
        if !self.allows_indirect {
            on.exprs([ExprTag::Ident], Self::check_identifier);
            on.exprs([ExprTag::This], Self::check_this);
        }
        Known::default()
    }
}
