use bun_lint_oxlint::ast_util::static_property_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow recursive access to `this` within getters and setters.
pub struct NoAccessorRecursion;

const NO_ACCESSOR_RECURSION: Message = Message::new("", "Disallow recursive access to `this` within {{kind}}.");

impl Rule for NoAccessorRecursion {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-accessor-recursion", Kind::Problem);
    /// The function whose `this` the `this` at a place is. `Some(None)`: that of a class.
    type State<'a> = AncestorMemo<'a, Option<Func<'a>>>;

    fn new(_: &Options) -> Self {
        NoAccessorRecursion
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        let is_accessor = |it: Func| matches!(it.kind(), FnKind::Getter | FnKind::Setter);
        if file.has_exprs([ExprTag::This]) && file.funcs().any(is_accessor) {
            on.exprs([ExprTag::This], check);
        }
        AncestorMemo::default()
    }
}

fn without_hash(name: &[u8]) -> &[u8] {
    name.strip_prefix(b"#").unwrap_or(name)
}

fn check<'a>(_: &NoAccessorRecursion, this: Expr<'a>, cx: &mut Cx<'a, NoAccessorRecursion>) {
    let target = this.parent();
    match target {
        Node::Expr(member) if member.object() == Some(this) && !member.is_jsx_tag_name() => {}
        Node::VarDecl(declarator) if declarator.pat().tag() == PatTag::Object => {}
        _ => return,
    }
    let nearest_function = cx.state.find(Node::Expr(this), |_, parent| match parent {
        Node::Func(func) if !func.is_arrow() && func.kind() != FnKind::StaticBlock => Some(Some(func)),
        Node::Class(_) => Some(None),
        _ => None,
    });
    let Some(Some(accessor)) = nearest_function else {
        return;
    };
    if !matches!(accessor.kind(), FnKind::Getter | FnKind::Setter) {
        return;
    }
    let key = match accessor.owner() {
        Node::Member(member) => member.key(),
        Node::Expr(function) => match function.parent() {
            Node::Prop(prop) => prop.key(),
            _ => None,
        },
        _ => None,
    };
    let Some(key) = key.filter(|it| !it.is_computed()) else {
        return;
    };
    let Some(key_name) = key.name().map(|it| without_hash(it.bytes())) else {
        return;
    };
    match target {
        Node::VarDecl(declarator) => {
            if let PatKind::Object(properties) = declarator.pat().kind()
                && properties.iter().any(|it| it.key().and_then(Key::name).is_some_and(|it| it.bytes() == key_name))
            {
                cx.report(declarator, NO_ACCESSOR_RECURSION).data("kind", "getters");
            }
        }
        Node::Expr(member) => {
            let is_same_key = match member.is_private_member() {
                true => {
                    key.is_private() && member.member_name().is_some_and(|it| without_hash(it.bytes()) == key_name)
                }
                false => static_property_name(member).is_some_and(|it| it.bytes() == key_name),
            };
            if !is_same_key {
                return;
            }
            if accessor.kind() == FnKind::Getter {
                cx.report(member, NO_ACCESSOR_RECURSION).data("kind", "getters");
            } else if is_property_write(member) {
                cx.report(member, NO_ACCESSOR_RECURSION).data("kind", "setters");
            }
        }
        _ => {}
    }
}

/// `this.bar = 1`, `++this.bar`, and whatever is at most three levels below a destructuring assignment: `[this.bar] = a`,
/// but also `[a = this.bar] = b`.
fn is_property_write(member: Expr) -> bool {
    if let Node::Expr(parent) = member.parent() {
        match parent.kind() {
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => return true,
            ExprKind::Assign { target, .. } if target == member => return true,
            _ => {}
        }
    }
    let (mut child, mut levels) = (Node::Expr(member), 0);
    loop {
        let parent = child.parent();
        levels += match (child, parent) {
            // A function and its body that is an expression are one level.
            (_, Node::Func(func)) if func.body_span().is_none() => 0,
            (Node::Expr(e), _) if e.is_parenthesized() => e.parens().len() + 1,
            _ => 1,
        };
        let is_pattern = match parent {
            Node::File(_) => return false,
            Node::Expr(e) => {
                matches!(e.tag(), ExprTag::Array | ExprTag::Object | ExprTag::Assign) && e.is_assignment_target()
            }
            Node::Prop(prop) => matches!(prop.parent(), Node::Expr(object) if object.is_assignment_target()),
            _ => false,
        };
        if levels > 3 || is_pattern {
            return levels <= 3;
        }
        child = parent;
    }
}
