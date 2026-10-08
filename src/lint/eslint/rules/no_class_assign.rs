use bun_lint::prelude::*;

/// Disallow reassigning class members.
pub struct NoClassAssign;

const CLASS: Message = Message::new("class", "'{{name}}' is a class.");

impl NoClassAssign {
    fn check<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let Some(symbol) = class.symbol() else {
            return;
        };
        for reference in ast_utils::get_modifying_references(symbol.references()) {
            cx.report(reference, CLASS).data("name", reference.name());
        }
    }
}

impl Rule for NoClassAssign {
    const META: Meta = Meta::eslint("no-class-assign", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoClassAssign
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.classes(Self::check);
    }
}
