use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce proper position of the first property in JSX
pub struct JsxFirstPropNewLine {
    configuration: Configuration,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Configuration {
    Always,
    Never,
    Multiline,
    MultilineMultiprop,
    Multiprop,
}

const PROP_ON_NEW_LINE: Message = Message::new("propOnNewLine", "Property should be placed on a new line");
const PROP_ON_SAME_LINE: Message =
    Message::new("propOnSameLine", "Property should be placed on the same line as the component declaration");

impl Rule for JsxFirstPropNewLine {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-first-prop-new-line", Kind::Layout).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        JsxFirstPropNewLine {
            configuration: match options.str(0) {
                Some("always") => Configuration::Always,
                Some("never") => Configuration::Never,
                Some("multiline") => Configuration::Multiline,
                Some("multiprop") => Configuration::Multiprop,
                _ => Configuration::MultilineMultiprop,
            },
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        // Without an attribute upstream says nothing, or throws: `"multiprop"`, a tag of several lines.
        let (Some(name), Some(first_node)) = (jsx.tag(), jsx.attrs().first()) else {
            return;
        };
        let (file, node, has_several) = (cx.file(), jsx.opening_span(), jsx.attrs().len() > 1);
        // `isMultilineJSX`
        let is_multiline = || file.line_of(node.start) < file.line_of(node.end);
        let wants_new_line = match self.configuration {
            Configuration::Always => true,
            Configuration::Never => false,
            Configuration::Multiline => is_multiline(),
            Configuration::MultilineMultiprop => has_several && is_multiline(),
            Configuration::Multiprop => has_several,
        };
        if wants_new_line {
            if file.line_of(first_node.span().start) == file.line_of(node.start) {
                cx.report(first_node, PROP_ON_NEW_LINE).fix(|fixer| {
                    let before = jsx.type_args().angle_brackets_span().unwrap_or_else(|| name.span());
                    fixer.replace(before.between(first_node.span()), "\n")
                });
            }
        } else if (self.configuration == Configuration::Never
            || (self.configuration == Configuration::Multiprop && is_multiline()))
            && file.line_of(node.start) < file.line_of(first_node.span().start)
        {
            // The type arguments go with the blanks.
            cx.report(first_node, PROP_ON_SAME_LINE)
                .fix(|fixer| fixer.replace(name.span().between(first_node.span()), " "));
        }
    }
}
