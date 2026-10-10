use super::react_sort_default_props::{PROPS_NOT_SORTED, SortDefaultProps, member_expression, property_definition};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce defaultProps declarations alphabetical sorting
pub struct JsxSortDefaultProps(SortDefaultProps);

impl Rule for JsxSortDefaultProps {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-sort-default-props", Kind::None).deprecated();
    const ON: On = SortDefaultProps::ON;
    type State<'a> = Vec<Expr<'a>>;

    fn new(options: &Options) -> Self {
        JsxSortDefaultProps(SortDefaultProps::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Vec<Expr<'a>>> {
        self.0.start(file)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.extend(member_expression(e));
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.extend(property_definition(member));
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut objects = std::mem::take(&mut cx.state);
        self.0.check_sorted(&mut objects, &mut |unsorted| {
            cx.report(unsorted, PROPS_NOT_SORTED);
            !cx.has_reported_too_much()
        });
    }
}
