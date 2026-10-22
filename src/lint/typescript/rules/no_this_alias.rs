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
        // For oxc `(this)` isn't a `this`.
        if cx.language().is_oxlint && this.is_parenthesized() {
            return;
        }
        // The target `this` is assigned to: its span, and its name if it's an identifier.
        let (id, name) = match this.parent() {
            // oxlint's span excludes the type.
            Node::VarDecl(declaration) if cx.language().is_oxlint => {
                (declaration.pat().span(), declaration.pat().as_ident())
            }
            Node::VarDecl(declaration) => (declaration.binding_span(), declaration.pat().as_ident()),
            Node::Expr(parent) => match parent.as_assign() {
                // oxlint finds the `a` in `a! = this` and `(a as T) = this`.
                Some((_, target, value))
                    if value == this
                        && !utils::is_assignment_target(parent)
                        && cx.language().is_oxlint
                        && !matches!(target.tag(), ExprTag::Ident | ExprTag::Array | ExprTag::Object) =>
                {
                    match target.skip_type_wrappers().as_ident() {
                        Some(name) => (target.skip_type_wrappers().span(), Some(name)),
                        None => return,
                    }
                }
                Some((_, target, value)) if value == this && !utils::is_assignment_target(parent) => {
                    (target.span(), target.as_ident())
                }
                _ => return,
            },
            _ => return,
        };
        match name {
            Some(name) => {
                if !self.allowed_names.iter().any(|allowed| name == **allowed) {
                    cx.report(id, THIS_ASSIGNMENT)
                        .hint("Use an arrow function instead. It has the this of the code around it.");
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
    const META: Meta = Meta::typescript("no-this-alias", Kind::Suggestion).recommended().hints();
    const ON: On = On::new().exprs(&[ExprTag::This]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoThisAlias {
            allow_destructuring: options.bool_or("allowDestructuring", true),
            // `allowNames` was oxlint's original name for it.
            allowed_names: options
                .strings("allowedNames")
                .into_iter()
                .chain(options.strings("allowNames"))
                .map(|name| name.as_bytes().into())
                .collect(),
        }
    }

    fn expr<'a>(&self, this: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(this, cx);
    }
}
