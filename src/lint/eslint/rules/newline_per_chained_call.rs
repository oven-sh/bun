use bun_lint::prelude::*;

/// Require a newline after each call in a method chain.
pub struct NewlinePerChainedCall {
    ignore_chain_with_depth: usize,
}

const EXPECTED: Message = Message::new("expected", "Expected line break before `{{callee}}`.");

fn object_of(member: Expr<'_>) -> Option<Expr<'_>> {
    match member.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
        _ => None,
    }
}

impl NewlinePerChainedCall {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let callee = call.callee();
        let (object, property, is_computed) = match callee.kind() {
            ExprKind::Dot { obj, name, .. } => (obj, name.span(), false),
            ExprKind::Index { obj, index, .. } => (obj, index.span(), true),
            _ => return,
        };

        let mut depth = 1;
        let mut parent = Some(object);
        while let Some(ExprKind::Call(call) | ExprKind::New(call)) = parent.map(Expr::kind) {
            depth += 1;
            parent = object_of(call.callee());
        }
        if depth <= self.ignore_chain_with_depth
            || !cx.is_on_same_line(object.span().end, property.start)
        {
            return;
        }

        let after_object = skip_trivia(cx.text(), object.outer_span().end);
        let written = cx.slice(property);
        let first_line = text::find_line_break(written).map(|it| &written[..it.0]);
        let mut name = Vec::with_capacity(written.len() + 4);
        if callee.is_optional() {
            name.extend_from_slice(b"?.");
        } else if !is_computed {
            name.push(b'.');
        }
        if is_computed {
            name.push(b'[');
        }
        name.extend_from_slice(first_line.unwrap_or(written));
        if is_computed && first_line.is_none() {
            name.push(b']');
        }
        cx.report(Span::new(after_object, callee.span().end), EXPECTED)
            .data("callee", name)
            .fix(|fixer| fixer.insert_before(Span::empty(after_object), "\n"));
    }
}

impl Rule for NewlinePerChainedCall {
    const META: Meta = Meta::eslint("newline-per-chained-call", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let depth = options.object(0).usize("ignoreChainWithDepth");
        NewlinePerChainedCall {
            ignore_chain_with_depth: depth.filter(|it| *it != 0).unwrap_or(2),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check);
    }
}
