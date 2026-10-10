use bun_lint::prelude::*;
use bun_lint::utils::keywords;

/// Enforce dot notation whenever possible.
pub struct DotNotation {
    allows_keywords: bool,
    allow_pattern: Option<Regex>,
}

const USE_DOT: Message = Message::new("useDot", "[{{key}}] is better written in dot notation.");
const USE_BRACKETS: Message = Message::new("useBrackets", ".{{key}} is a syntax error.");

/// Reports the `name` of `object.name`, which is a keyword.
fn report_keyword<'a, R: Rule>(cx: &Cx<'a, R>, name: Ident<'a>, is_optional: bool, is_after_let: bool) {
    cx.report(name, USE_BRACKETS).data("key", name).fix(|fixer| {
        let file = fixer.file();
        let dot = file.token_before(name)?;
        // A statement that starts with `let[` declares variables. tsgolint does not mind comments.
        if (is_after_let && !is_optional) || file.comments_exist_between(dot, name) && !file.language().is_oxlint {
            return None;
        }
        let brackets = fixer.replace(name, [&b"[\""[..], name.bytes(), b"\"]"].concat());
        Some(match is_optional {
            true => vec![brackets],
            false => vec![fixer.remove(dot), brackets],
        })
    });
}

impl DotNotation {
    /// ESLint's `checkComputedProperty`, and what decides whether it is called.
    fn check_computed_property<'a, R: Rule>(&self, e: Expr<'a>, cx: &Cx<'a, R>) {
        let ExprKind::Index { obj, index, chain } = e.kind() else {
            return;
        };
        let (value, quote) = match index.kind() {
            ExprKind::String(value) => (value.bytes(), "\""),
            ExprKind::True => (&b"true"[..], ""),
            ExprKind::False => (&b"false"[..], ""),
            ExprKind::Null => (&b"null"[..], ""),
            ExprKind::Template(template) => match template.as_static() {
                Some(value) => (value.bytes(), "`"),
                None => return,
            },
            _ => return,
        };
        if !(value.is_ascii() && bun_core::lexer::is_identifier(value))
            || (!self.allows_keywords && keywords::is_keyword(value))
            || self.allow_pattern.as_ref().is_some_and(|pattern| pattern.test(value))
        {
            return;
        }
        cx.report(index, USE_DOT)
            .data("key", [quote.as_bytes(), value, quote.as_bytes()].concat())
            .fix(|fixer| {
                let file = fixer.file();
                let left_bracket = file.tokens_after(obj).find(ast_utils::is_opening_bracket_token)?;
                let right_bracket = file.last_token(e)?;
                if file.comments_exist_between(left_bracket, right_bracket) && !file.language().is_oxlint {
                    return None;
                }
                let mut text = Vec::with_capacity(value.len() + 3);
                if chain != Chain::Start {
                    if ast_utils::is_decimal_integer(obj) {
                        text.push(b' ');
                    }
                    text.push(b'.');
                }
                text.extend_from_slice(value);
                if let Some(next) = file.token_after(e)
                    && next.start() == right_bracket.end()
                    && !ast_utils::can_tokens_be_adjacent(value, next)
                {
                    text.push(b' ');
                }
                Some(fixer.replace(Span::new(left_bracket.start(), right_bracket.end()), text))
            });
    }

    /// ESLint's listener for `MemberExpression`. `e` is a `Dot` or an `Index`.
    pub fn check_member_expression<'a, R: Rule>(&self, e: Expr<'a>, cx: &Cx<'a, R>) {
        match e.kind() {
            ExprKind::Index { .. } => self.check_computed_property(e, cx),
            ExprKind::Dot { obj, name, chain }
                if !self.allows_keywords
                    && keywords::is_keyword(name.bytes())
                    && ast_utils::is_member_expression(e) =>
            {
                report_keyword(cx, name, chain == Chain::Start, obj.is_ident("let"));
            }
            _ => {}
        }
    }

    /// The same for the `a.b` of `implements a.b`, and of `extends a.b` of an interface: ESTree has
    /// a `MemberExpression` there.
    pub fn check_heritage<'a, R: Rule>(&self, ty: TypeNode<'a>, cx: &Cx<'a, R>) {
        let TypeKind::Ref { name, .. } = ty.kind() else {
            return;
        };
        if self.allows_keywords {
            return;
        }
        for (i, part) in name.parts().enumerate().skip(1) {
            if keywords::is_keyword(part.bytes()) {
                let is_after_let = i == 1 && name.first().is_some_and(|first| first.name().is("let"));
                report_keyword(cx, part, false, is_after_let);
            }
        }
    }

    /// Whether a `Dot` can be reported, and [`DotNotation::check_heritage`] can report anything.
    pub fn checks_keywords(&self) -> bool {
        !self.allows_keywords
    }
}

impl Rule for DotNotation {
    const META: Meta = Meta::eslint("dot-notation", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let pattern = options.str("allowPattern").filter(|pattern| !pattern.is_empty());
        DotNotation {
            allows_keywords: options.bool_or("allowKeywords", true),
            allow_pattern: pattern.and_then(|pattern| Regex::new(pattern, "u").ok()),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.exprs([ExprTag::Index], |rule, e, cx| rule.check_member_expression(e, cx));
        if !self.checks_keywords() {
            return;
        }
        on.exprs([ExprTag::Dot], |rule, e, cx| rule.check_member_expression(e, cx));
        if !file.is_javascript() {
            on.classes(|rule, class, cx| {
                for ty in class.implements() {
                    rule.check_heritage(ty, cx);
                }
            });
            on.stmts([StmtTag::Interface], |rule, statement, cx| {
                if let StmtKind::Interface(interface) = statement.kind() {
                    for ty in interface.extends() {
                        rule.check_heritage(ty, cx);
                    }
                }
            });
        }
    }
}
