use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_magic_numbers::Checker;

/// Disallow magic numbers.
pub struct NoMagicNumbers(Checker);

impl Rule for NoMagicNumbers {
    const META: Meta =
        Meta::typescript("no-magic-numbers", Kind::Suggestion).extends_base_rule("no-magic-numbers");
    const ON: On = Checker::ON;
    no_state!();

    fn new(options: &Options) -> Self {
        NoMagicNumbers(Checker::new(options, true))
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        self.0.narrow()
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.0.expr(e, cx);
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        self.0.ty(ty, cx);
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        self.0.pat(pattern, cx);
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        self.0.member(member, cx);
    }

    fn prop<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        self.0.prop(property, cx);
    }

    fn enum_member<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        self.0.enum_member(member, cx);
    }
}
