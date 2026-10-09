use bun_core::strings;
use bun_lint::prelude::*;

/// Require parentheses around arrow function arguments.
pub struct ArrowParens {
    is_as_needed: bool,
    requires_for_block_body: bool,
}

const UNEXPECTED_PARENS: Message = Message::new(
    "unexpectedParens",
    "Unexpected parentheses around single function argument.",
);
const EXPECTED_PARENS: Message = Message::new(
    "expectedParens",
    "Expected parentheses around arrow function argument.",
);
const UNEXPECTED_PARENS_INLINE: Message = Message::new(
    "unexpectedParensInline",
    "Unexpected parentheses around single function argument having a body with no curly braces.",
);
const EXPECTED_PARENS_BLOCK: Message = Message::new(
    "expectedParensBlock",
    "Expected parentheses around arrow function argument having a body with curly braces.",
);

impl ArrowParens {
    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !func.is_arrow() {
            return;
        }
        let mut params = func.params_with_this();
        let (Some(param), None) = (params.next(), params.next()) else {
            return;
        };
        let should_have_parens = !self.is_as_needed
            || (self.requires_for_block_body && matches!(func.body(), FnBody::Block(_)));
        let name = param.binding_span();

        let Some(close) = func.close_paren() else {
            if should_have_parens {
                let message = match self.requires_for_block_body {
                    true => EXPECTED_PARENS_BLOCK,
                    false => EXPECTED_PARENS,
                };
                cx.report(name, message)
                    .fix(|fixer| [fixer.insert_before(name, "("), fixer.insert_after(name, ")")]);
            }
            return;
        };

        if should_have_parens
            || param.pat().tag() != PatTag::Ident
            || param.is_rest()
            || param.default().is_some()
            || param.ty().is_some()
            || func.return_type().is_some()
            || !func.type_params().is_empty()
        {
            return;
        }
        // Anything but whitespace and a trailing comma inside the parentheses is a comment.
        let before_name = strings::trim_js_whitespace_end(cx.slice(Span::before(0, name)));
        let Some(before_open) = before_name.strip_suffix(b"(") else {
            return;
        };
        if !matches!(strings::trim_js_whitespace(cx.slice(Span::after(name, close))), b"" | b",") {
            return;
        }
        let open = Span::new(before_open.len() as u32, before_open.len() as u32 + 1);

        let message = match self.requires_for_block_body {
            true => UNEXPECTED_PARENS_INLINE,
            false => UNEXPECTED_PARENS,
        };
        cx.report(name, message).fix(|fixer| {
            let file = fixer.file();
            let mut fixes = Vec::with_capacity(3);
            if let (Some(before), Some(first)) = (file.token_before(open), file.first_token(name))
                && before.end() == open.start
                && !ast_utils::can_tokens_be_adjacent(before, first)
            {
                fixes.push(fixer.insert_before(open, " "));
            }
            fixes.push(fixer.remove(Span::new(open.start, name.start)));
            fixes.push(fixer.remove(Span::after(name, close + 1)));
            fixes
        });
    }
}

impl Rule for ArrowParens {
    const META: Meta = Meta::eslint("arrow-parens", Kind::Layout)
        .fixable(Fixable::Code)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let is_as_needed = options.str(0) == Some("as-needed");
        ArrowParens {
            is_as_needed,
            requires_for_block_body: is_as_needed
                && options.object(1).bool_or("requireForBlockBody", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check);
    }
}
