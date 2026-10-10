use bun_lint::prelude::*;

/// Disallow reassigning class members.
pub struct NoClassAssign;

const CLASS: Message = Message::new("class", "'{{name}}' is a class.");

impl Rule for NoClassAssign {
    const META: Meta = Meta::eslint("no-class-assign", Kind::Problem).recommended();
    const ON: On = On::new().classes();
    no_state!();

    fn new(_: &Options) -> Self {
        NoClassAssign
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let Some(symbol) = class.symbol().filter(|it| it.has_modifying_references()) else {
            return;
        };
        // oxlint points at the declaration.
        let declared = class.name().filter(|_| cx.language().is_oxlint).map(|it| it.span());
        for reference in ast_utils::get_modifying_references(symbol.references()) {
            let report = cx.report(declared.unwrap_or_else(|| reference.span()), CLASS).data("name", reference.name());
            report.labels_with(|labels| {
                let name = bstr::BStr::new(reference.name().bytes());
                labels.push(reference.span(), format!("{name} is re-assigned here"));
            });
        }
    }
}
