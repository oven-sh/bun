use bun_core::strings;
use bun_lint::prelude::*;

/// Enforce consistent spacing inside computed property brackets.
pub struct ComputedPropertySpacing {
    is_always: bool,
    enforces_for_class_members: bool,
}

const UNEXPECTED_SPACE_BEFORE: Message = Message::new(
    "unexpectedSpaceBefore",
    "There should be no space before '{{tokenValue}}'.",
);
const UNEXPECTED_SPACE_AFTER: Message = Message::new(
    "unexpectedSpaceAfter",
    "There should be no space after '{{tokenValue}}'.",
);
const MISSING_SPACE_BEFORE: Message = Message::new(
    "missingSpaceBefore",
    "A space is required before '{{tokenValue}}'.",
);
const MISSING_SPACE_AFTER: Message = Message::new(
    "missingSpaceAfter",
    "A space is required after '{{tokenValue}}'.",
);

impl ComputedPropertySpacing {
    /// `open` and `close`: where the `[` and the `]` are.
    fn check_brackets<'a>(&self, open: u32, close: u32, cx: &Cx<'a, Self>) {
        let inside = cx.slice(Span::new(open + 1, close));
        let leading = (inside.len() - strings::trim_js_whitespace_start(inside).len()) as u32;
        let trailing = (inside.len() - strings::trim_js_whitespace_end(inside).len()) as u32;

        let after_open = Span::new(open + 1, open + 1 + leading);
        if self.is_always && leading == 0 {
            let bracket = Span::new(open, open + 1);
            cx.report(bracket, MISSING_SPACE_AFTER)
                .data("tokenValue", "[")
                .fix(|fixer| fixer.insert_after(bracket, " "));
        } else if !self.is_always && leading > 0 && !strings::contains_js_line_break(cx.slice(after_open)) {
            cx.report(after_open, UNEXPECTED_SPACE_AFTER)
                .data("tokenValue", "[")
                .fix(|fixer| fixer.remove(after_open));
        }

        let before_close = Span::new(close - trailing, close);
        if self.is_always && trailing == 0 {
            let bracket = Span::new(close, close + 1);
            cx.report(bracket, MISSING_SPACE_BEFORE)
                .data("tokenValue", "]")
                .fix(|fixer| fixer.insert_before(bracket, " "));
        } else if !self.is_always && trailing > 0 && !strings::contains_js_line_break(cx.slice(before_close)) {
            cx.report(before_close, UNEXPECTED_SPACE_BEFORE)
                .data("tokenValue", "]")
                .fix(|fixer| fixer.remove(before_close));
        }
    }

    fn check_key<'a>(&self, key: Option<Key<'a>>, cx: &Cx<'a, Self>) {
        if let Some(key) = key
            && key.is_computed()
        {
            let brackets = key.span(cx.file());
            self.check_brackets(brackets.start, brackets.end - 1, cx);
        }
    }
}

impl Rule for ComputedPropertySpacing {
    const META: Meta = Meta::eslint("computed-property-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Index]).pats(&[PatTag::Object]).members().props();
    no_state!();

    fn new(options: &Options) -> Self {
        ComputedPropertySpacing {
            is_always: options.str(0) == Some("always"),
            enforces_for_class_members: options.object(1).bool_or("enforceForClassMembers", true),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Index]).props().pats(&[PatTag::Object]);
        if self.enforces_for_class_members { on.members() } else { on }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Index { obj, index, chain } = e.kind() else {
            return;
        };
        let source = cx.text();
        let mut open = skip_trivia(source, obj.outer_span().end);
        if chain == Chain::Start {
            open = skip_trivia(source, open + "?.".len() as u32);
        }
        let close = skip_trivia(source, index.outer_span().end);
        if source.get(open as usize) == Some(&b'[') && source.get(close as usize) == Some(&b']') {
            self.check_brackets(open, close, cx);
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if let PatKind::Object(props) = pat.kind() {
            for prop in props {
                self.check_key(prop.key(), cx);
            }
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        // Only `MethodDefinition` and `PropertyDefinition`.
        if !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR) && !member.is_signature() {
            self.check_key(member.key(), cx);
        }
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        self.check_key(prop.key(), cx);
    }
}
