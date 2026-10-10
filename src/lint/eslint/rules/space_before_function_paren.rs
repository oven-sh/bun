use bun_lint::prelude::*;

/// Enforce consistent spacing before `function` definition opening parenthesis.
pub struct SpaceBeforeFunctionParen {
    anonymous: Config,
    named: Config,
    async_arrow: Config,
}

#[derive(Copy, Clone, PartialEq)]
enum Config {
    Always,
    Never,
    Ignore,
}

impl Config {
    fn parse(value: Option<&str>, default: Config) -> Config {
        match value {
            Some("always") => Config::Always,
            Some("never") => Config::Never,
            Some("ignore") => Config::Ignore,
            _ => default,
        }
    }
}

const UNEXPECTED_SPACE: Message =
    Message::new("unexpectedSpace", "Unexpected space before function parentheses.");
const MISSING_SPACE: Message =
    Message::new("missingSpace", "Missing space before function parentheses.");

impl Rule for SpaceBeforeFunctionParen {
    const META: Meta = Meta::eslint("space-before-function-paren", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().funcs();
    no_state!();

    fn new(options: &Options) -> Self {
        let base = Config::parse(options.str(0), Config::Always);
        let overrides = options.object(0);
        SpaceBeforeFunctionParen {
            anonymous: Config::parse(overrides.str("anonymous"), base),
            named: Config::parse(overrides.str("named"), base),
            async_arrow: Config::parse(overrides.str("asyncArrow"), base),
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !func.has_body() {
            return;
        }
        let config = match func.kind() {
            FnKind::Arrow if func.is_async() => self.async_arrow,
            FnKind::Decl | FnKind::Expr if func.name().is_none() => match func.is_generator() {
                // Left to `generator-star-spacing`.
                true => return,
                false => self.anonymous,
            },
            FnKind::Decl
            | FnKind::Expr
            | FnKind::Method
            | FnKind::Getter
            | FnKind::Setter
            | FnKind::Constructor => self.named,
            _ => return,
        };
        if config == Config::Ignore {
            return;
        }
        let text = cx.text();
        let open = if func.is_arrow() {
            // Not `async a => a`, `async <T>() => a`
            let second = skip_trivia(text, func.estree_span().start + "async".len() as u32);
            (text.get(second as usize) == Some(&b'(')).then_some(second)
        } else if func.type_params().is_empty() {
            func.open_paren()
        } else {
            // The first `(` can be in the type parameters.
            let mut tokens = cx.file().tokens_in(func.estree_span());
            tokens.find(|token| token.is_punctuator("(")).map(Token::start)
        };
        let Some(open) = open else {
            return;
        };
        let left_end = skip_trivia_back(text, open);
        let has_spacing = match text.get(left_end as usize..open as usize) {
            None | Some([]) => false,
            Some([b'/', ..]) => cx.file().is_space_between(Span::empty(left_end), Span::empty(open)),
            Some(_) => true,
        };
        if has_spacing && config == Config::Never {
            let between = Span::new(left_end, open);
            cx.report(between, UNEXPECTED_SPACE).fix(|fixer| {
                let mut comments = Vec::new();
                for comment in fixer.file().comments_in(between) {
                    if comment.kind() == TokenKind::Line {
                        return None;
                    }
                    comments.extend_from_slice(comment.text());
                }
                Some(fixer.replace(between, comments))
            });
        } else if !has_spacing && config == Config::Always {
            cx.report(Span::new(open, open + 1), MISSING_SPACE)
                .fix(|fixer| fixer.insert_after(Span::empty(left_end), " "));
        }
    }
}
