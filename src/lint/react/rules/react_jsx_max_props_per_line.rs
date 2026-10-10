use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce maximum of props on a single line in JSX
pub struct JsxMaxPropsPerLine {
    /// In a tag of one line. `None`: `Infinity`.
    single: Option<usize>,
    /// In a tag of several lines.
    multi: Option<usize>,
}

const NEW_LINE: Message = Message::new("newLine", "Prop `{{prop}}` must be placed on a new line");

impl Rule for JsxMaxPropsPerLine {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-max-props-per-line", Kind::Layout).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let configuration = options.object(0);
        // With a number that is no integer upstream throws where it would report.
        let count = |it: Option<f64>| it.filter(|it| *it >= 1.0 && it.fract() == 0.0).map(|it| it as usize);
        if configuration.has("maximum") && configuration.number("maximum").is_none() {
            let maximum = configuration.object("maximum");
            let (single, multi) = (count(maximum.number("single")), count(maximum.number("multi")));
            return JsxMaxPropsPerLine { single, multi };
        }
        let multi = count(Some(configuration.number("maximum").unwrap_or(1.0)));
        JsxMaxPropsPerLine { single: multi.filter(|_| configuration.str("when") != Some("multiline")), multi }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let attributes = jsx.attrs();
        let fits = |max: Option<usize>| max.is_none_or(|it| attributes.len() <= it);
        if fits(self.single) && fits(self.multi) {
            return;
        }
        let file = cx.file();
        let is_single_line_tag = ast_utils::is_on_one_line(file, jsx.opening_span());
        let Some(max) = (if is_single_line_tag { self.single } else { self.multi }) else {
            return;
        };
        // `linePartitionedProps`, one after the other: where the line starts, and how many it has.
        let mut rest = attributes.iter();
        let (mut line, mut count, mut last) = (rest, 0, None::<Prop<'a>>);
        loop {
            let from_here = rest;
            let Some(decl) = rest.next() else {
                break;
            };
            if last.is_some_and(|last| !ast_utils::is_on_one_line(file, last.span().between(decl.span()))) {
                check_line(line, count, max, cx);
                (line, count) = (from_here, 0);
            }
            count += 1;
            last = Some(decl);
        }
        check_line(line, count, max, cx);
    }
}

/// The first `count` of `line` are the attributes of one line.
fn check_line<'a>(mut line: ListIter<'a, Prop<'a>>, count: usize, max: usize, cx: &Cx<'a, JsxMaxPropsPerLine>) {
    if count <= max {
        return;
    }
    let props_in_line = line.take(count);
    let Some(prop) = line.nth(max) else {
        return;
    };
    // `getPropName`: of `a:b` upstream takes the node `b` for the name.
    let name = match prop.key().and_then(Key::name) {
        Some(name) if strings::contains_char(name.bytes(), b':') => &b"[object Object]"[..],
        Some(name) => name.bytes(),
        None => prop.value().map_or(&b""[..], Expr::text),
    };
    cx.report(prop, NEW_LINE).data("prop", name).fix(|fixer| {
        let (mut code, mut range) = (Vec::new(), None::<Span>);
        for (i, node) in props_in_line.enumerate() {
            if i > 0 {
                code.push(if i % max == 0 { b'\n' } else { b' ' });
            }
            code.extend_from_slice(node.text());
            range = Some(range.unwrap_or_else(|| node.span()).to(node.span()));
        }
        Some(fixer.replace(range?, code))
    });
}
