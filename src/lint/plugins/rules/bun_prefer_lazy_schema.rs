use crate::bun::{RunsLater, chain_start, is_listed, list_option, runs_while_module_is_evaluated};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::get_declaration_of_variable;

/// Disallow building a validation schema while the module is evaluated.
///
/// By default what starts with `z`, as Zod's documentation imports it.
pub struct PreferLazySchema {
    roots: Box<[Box<[u8]>]>,
    methods: Box<[Box<[u8]>]>,
    factory_suffix: Option<Box<[u8]>>,
    lazy_wrapper: Option<Box<[u8]>>,
}

const EAGER_SCHEMA: Message = Message::new(
    "eagerSchema",
    "This schema is built as soon as the module is evaluated. Build it when it is first used.",
);
const EAGER_SCHEMA_WITH_WRAPPER: Message = Message::new(
    "eagerSchemaWithWrapper",
    "This schema is built as soon as the module is evaluated. Build it when it is first used: `{{wrapper}}(() => ..)`.",
);

impl PreferLazySchema {
    /// `z`, if that is imported or a global variable.
    fn is_root(&self, e: Expr) -> bool {
        use Declaration::{ImportDefault, ImportNamespace, ImportSpec};
        e.as_ident().is_some_and(|name| is_listed(&self.roots, name.bytes()))
            && get_declaration_of_variable(e)
                .is_none_or(|it| matches!(it, ImportDefault(_) | ImportNamespace(_) | ImportSpec(_)))
    }

    /// Whether `node` is a call that makes a schema, and all of its chain: not the `z.string()` of `z.string().min(1)`.
    fn builds_schema(&self, node: Node) -> bool {
        let Some((e, callee)) = node.as_expr().and_then(|e| Some((e, e.callee()?))) else {
            return false;
        };
        if matches!(e.parent(), Node::Expr(parent) if parent.object() == Some(e) || parent.tag() == ExprTag::NonNull) {
            return false;
        }
        match callee.kind() {
            ExprKind::Ident(name) => self.factory_suffix.as_deref().is_some_and(|it| name.bytes().ends_with(it)),
            ExprKind::Dot { name, .. } => is_listed(&self.methods, name.bytes()) || self.is_root(chain_start(callee)),
            _ => false,
        }
    }
}

/// `z.lazy(..)`, which builds nothing yet.
fn is_lazy(node: Node) -> bool {
    let callee = node.as_expr().and_then(Expr::callee).map(Expr::kind);
    matches!(callee, Some(ExprKind::Dot { obj, name, .. }) if name.name().is("lazy") && obj.tag() == ExprTag::Ident)
}

impl Rule for PreferLazySchema {
    const META: Meta = Meta::plugin(Plugin::Bun, "prefer-lazy-schema", Kind::Suggestion);
    /// In how many calls that make a schema the walk is: what another schema is made of is not reported beside it.
    type State<'a> = (u32, RunsLater<'a>);

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        PreferLazySchema {
            roots: list_option(options, "roots", &["z"]),
            methods: list_option(options, "methods", &[]),
            factory_suffix: config.str("factorySuffix").map(|it| it.as_bytes().into()),
            lazy_wrapper: config.str("lazyWrapper").map(|it| it.as_bytes().into()),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.enter(ExprTag::Call, |rule, node, cx| {
            if !rule.builds_schema(node) {
                return;
            }
            cx.state.0 += 1;
            if cx.state.0 == 1 && !is_lazy(node) && runs_while_module_is_evaluated(node, &mut cx.state.1) {
                match &rule.lazy_wrapper {
                    Some(wrapper) => cx.report(node, EAGER_SCHEMA_WITH_WRAPPER).data("wrapper", wrapper.to_vec()),
                    None => cx.report(node, EAGER_SCHEMA),
                };
            }
        });
        on.exit(ExprTag::Call, |rule, node, cx| {
            if rule.builds_schema(node) {
                cx.state.0 = cx.state.0.saturating_sub(1);
            }
        });
        (0, RunsLater::default())
    }
}
