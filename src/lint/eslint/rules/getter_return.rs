use bun_lint::prelude::*;

/// Enforce `return` statements in getters.
pub struct GetterReturn {
    allows_implicit: bool,
}

const EXPECTED: Message = Message::new("expected", "Expected to return a value in {{name}}.");
const EXPECTED_ALWAYS: Message = Message::new(
    "expectedAlways",
    "Expected {{name}} to always return a value.",
);

/// ESLint's `isGetter`
fn is_getter(func: Func) -> bool {
    if !matches!(func.body(), FnBody::Block(_)) {
        return false;
    }
    match func.kind() {
        FnKind::Getter => true,
        FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Setter => {
            let parent = match func.owner() {
                Node::Expr(e) => e.parent(),
                owner => owner,
            };
            let Node::Prop(prop) = parent else {
                return false;
            };
            let Node::Expr(object) = prop.parent() else {
                return false;
            };
            object.tag() == ExprTag::Object
                && ast_utils::get_static_property_name(prop).is_some_and(|name| &*name == b"get")
                && ast_utils::is_property_descriptor(object)
        }
        _ => false,
    }
}

impl GetterReturn {
    fn check_function<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !is_getter(func) {
            return;
        }
        if !self.allows_implicit {
            for statement in func.returns() {
                if matches!(statement.kind(), StmtKind::Return(None)) {
                    cx.report(statement, EXPECTED)
                        .data("name", ast_utils::get_function_name_with_kind(func));
                }
            }
        }
        if func.is_end_reachable() {
            let has_return = func.returns().next().is_some();
            cx.report(
                ast_utils::get_function_head_loc(func),
                if has_return { EXPECTED_ALWAYS } else { EXPECTED },
            )
            .data("name", ast_utils::get_function_name_with_kind(func));
        }
    }
}

impl Rule for GetterReturn {
    const META: Meta = Meta::eslint("getter-return", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        GetterReturn {
            allows_implicit: options.object(0).bool_or("allowImplicit", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_classes() || file.has_exprs([ExprTag::Object]) {
            on.funcs(Self::check_function);
        }
    }
}
