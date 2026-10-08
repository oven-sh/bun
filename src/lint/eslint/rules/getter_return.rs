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
            let Node::Prop(prop) = utils::estree_parent(Node::Func(func)) else {
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
    fn exit_function<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Func(func) = node else {
            return;
        };
        let Some((_, path)) = cx.state.pop_if(|it| it.0 == func) else {
            return;
        };
        if !self.allows_implicit {
            for statement in func.returns() {
                if matches!(statement.kind(), StmtKind::Return(None)) {
                    cx.report(statement, EXPECTED)
                        .data("name", ast_utils::get_function_name_with_kind(func));
                }
            }
        }
        if path.is_current_reachable() {
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
    /// The getters around the current node, each with its code path.
    type State<'a> = Vec<(Func<'a>, CodePath<'a>)>;

    fn new(options: &Options) -> Self {
        GetterReturn {
            allows_implicit: options.object(0).bool_or("allowImplicit", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        // TODO(api): replace by integrator::File::funcs(), to listen only if there is a getter.
        if !file.has_classes() && !file.has_exprs([ExprTag::Object]) {
            return Vec::new();
        }
        on.code_path_start(|_, path, node, cx| {
            if let Node::Func(func) = node
                && is_getter(func)
            {
                cx.state.push((func, path));
            }
        });
        on.exit(NodeTags::FUNC, Self::exit_function);
        Vec::new()
    }
}
