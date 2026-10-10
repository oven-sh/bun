use bun_lint::prelude::*;

/// Enforce consistent spacing around `*` operators in generator functions.
pub struct GeneratorStarSpacing {
    named: Mode,
    anonymous: Mode,
    method: Mode,
}

/// Whether a space is required on each side of the `*`.
#[derive(Copy, Clone)]
struct Mode {
    before: bool,
    after: bool,
}

const MISSING_BEFORE: Message = Message::new("missingBefore", "Missing space before *.");
const MISSING_AFTER: Message = Message::new("missingAfter", "Missing space after *.");
const UNEXPECTED_BEFORE: Message = Message::new("unexpectedBefore", "Unexpected space before *.");
const UNEXPECTED_AFTER: Message = Message::new("unexpectedAfter", "Unexpected space after *.");

/// ESLint's `optionToDefinition`
fn option_to_definition(option: Option<&Json>, defaults: Mode) -> Mode {
    let (before, after) = match option.and_then(Json::as_str) {
        Some(b"before") => (true, false),
        Some(b"after") => (false, true),
        Some(b"both") => (true, true),
        Some(b"neither") => (false, false),
        _ => {
            let option = Object::of(option);
            (option.bool_or("before", defaults.before), option.bool_or("after", defaults.after))
        }
    };
    Mode { before, after }
}

impl Rule for GeneratorStarSpacing {
    const META: Meta = Meta::eslint("generator-star-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().funcs();
    no_state!();

    fn new(options: &Options) -> Self {
        let option = options.get(0);
        let defaults = option_to_definition(
            option,
            Mode {
                before: true,
                after: false,
            },
        );
        let of = |kind: &str| option_to_definition(Object::of(option).get(kind), defaults);
        GeneratorStarSpacing {
            named: of("named"),
            anonymous: of("anonymous"),
            method: of("method"),
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !func.is_generator() || !func.has_body() {
            return;
        }
        // Where the `*` is looked for: a method starts with its decorators and modifiers.
        let (mode, within) = match (func.kind(), func.owner()) {
            (FnKind::Method, Node::Member(member)) => (self.method, member.span()),
            (FnKind::Method, Node::Expr(value)) => (self.method, value.parent().span()),
            (FnKind::Decl | FnKind::Expr, _) if func.name().is_some() => (self.named, func.estree_span()),
            (FnKind::Decl | FnKind::Expr, _) => (self.anonymous, func.estree_span()),
            _ => return,
        };
        let file = cx.file();
        let Some(star) = file.tokens_in(within).find(|token| token.is_punctuator("*")) else {
            return;
        };

        // Only after `function`, `static` or `async`.
        if (func.kind() != FnKind::Method || star.start() != within.start)
            && let Some(previous) = file.token_before(star)
            && (star.start() != previous.end()) != mode.before
        {
            match mode.before {
                true => cx.report(star, MISSING_BEFORE).fix(|fixer| fixer.insert_before(star, " ")),
                false => cx
                    .report(star, UNEXPECTED_BEFORE)
                    .fix(|fixer| fixer.remove(previous.span().between(star.span()))),
            };
        }

        if let Some(next) = file.token_after(star)
            && (next.start() != star.end()) != mode.after
        {
            match mode.after {
                true => cx.report(star, MISSING_AFTER).fix(|fixer| fixer.insert_after(star, " ")),
                false => cx
                    .report(star, UNEXPECTED_AFTER)
                    .fix(|fixer| fixer.remove(star.span().between(next.span()))),
            };
        }
    }
}
