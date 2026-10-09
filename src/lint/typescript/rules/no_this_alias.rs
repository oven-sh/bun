use bun_lint::prelude::*;

/// Disallow aliasing `this`.
pub struct NoThisAlias {
    allow_destructuring: bool,
    allowed_names: Vec<Box<[u8]>>,
}

const THIS_ASSIGNMENT: Message = Message::new(
    "thisAssignment",
    "Unexpected aliasing of 'this' to local variable.",
);
const THIS_DESTRUCTURE: Message = Message::new(
    "thisDestructure",
    "Unexpected aliasing of members of 'this' to local variables.",
);

impl NoThisAlias {
    fn check<'a>(&self, this: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // What `this` is assigned to: where it is, and its name if it is an identifier.
        let (id, name) = match this.parent() {
            // For oxlint without the type.
            Node::VarDecl(declaration) if cx.language().is_oxlint => {
                (declaration.pat().span(), declaration.pat().as_ident())
            }
            Node::VarDecl(declaration) => (declaration.binding_span(), declaration.pat().as_ident()),
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, value, .. }
                    if value == this && !utils::is_assignment_target(parent) =>
                {
                    (target.span(), target.as_ident())
                }
                _ => return,
            },
            _ => return,
        };
        match name {
            Some(name) => {
                if !self.allowed_names.iter().any(|allowed| name == **allowed) {
                    cx.report(id, THIS_ASSIGNMENT);
                }
            }
            None => {
                if !self.allow_destructuring {
                    cx.report(id, THIS_DESTRUCTURE);
                }
            }
        }
    }
}

impl Rule for NoThisAlias {
    const META: Meta = Meta::typescript("no-this-alias", Kind::Suggestion).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoThisAlias {
            allow_destructuring: options.bool_or("allowDestructuring", true),
            // `allowNames` is what oxlint called it at first.
            allowed_names: options
                .strings("allowedNames")
                .into_iter()
                .chain(options.strings("allowNames"))
                .map(|name| name.as_bytes().into())
                .collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::This], Self::check);
    }
}
