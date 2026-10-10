use super::react_sort_default_props::{PROPS_NOT_SORTED, SortDefaultProps};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce defaultProps declarations alphabetical sorting
pub struct JsxSortDefaultProps(SortDefaultProps);

impl Rule for JsxSortDefaultProps {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-sort-default-props", Kind::Suggestion).deprecated();
    const ON: On = SortDefaultProps::ON;
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        JsxSortDefaultProps(SortDefaultProps::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        self.0.start(file)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.0.member_expression(e, &mut |unsorted| {
            cx.report(unsorted, PROPS_NOT_SORTED);
        });
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        self.0.property_definition(member, &mut |unsorted| {
            cx.report(unsorted, PROPS_NOT_SORTED);
        });
    }
}
