use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::prelude::*;

/// Enforce the consistent use of either backticks, double, or single quotes.
pub struct Quotes {
    quote: u8,
    alternate_quote: u8,
    description: &'static str,
    avoids_escape: bool,
    allows_template_literals: bool,
}

const WRONG_QUOTES: Message = Message::new("wrongQuotes", "Strings must use {{description}}.");

/// ESLint's `QUOTE_SETTINGS[..].convert`: the string or the template `raw` in the quotes `new_quote`.
fn convert(raw: &[u8], new_quote: u8) -> Vec<u8> {
    let (Some(&old_quote), Some(inner)) = (raw.first(), raw.get(1..raw.len().saturating_sub(1))) else {
        return raw.to_vec();
    };
    if new_quote == old_quote {
        return raw.to_vec();
    }
    let mut out = Vec::with_capacity(raw.len() + 2);
    out.push(new_quote);
    let mut at = 0;
    while let Some(&byte) = inner.get(at) {
        let next = inner.get(at + 1).copied();
        let len = match (byte, next) {
            (b'\\', Some(b'$')) if inner.get(at + 2) == Some(&b'{') => {
                if old_quote != b'`' {
                    out.push(b'\\');
                }
                out.extend_from_slice(b"${");
                3
            }
            (b'\\', Some(b'\r')) if inner.get(at + 2) == Some(&b'\n') => {
                out.extend_from_slice(b"\\\r\n");
                3
            }
            (b'\\', Some(escaped)) => {
                if escaped != old_quote {
                    out.push(b'\\');
                }
                out.push(escaped);
                2
            }
            (b'"' | b'\'' | b'`', _) => {
                if byte == new_quote {
                    out.push(b'\\');
                }
                out.push(byte);
                1
            }
            (b'$', Some(b'{')) => {
                if new_quote == b'`' {
                    out.push(b'\\');
                }
                out.extend_from_slice(b"${");
                2
            }
            (b'\r' | b'\n', _) if old_quote == b'`' => {
                out.extend_from_slice(b"\\n");
                if byte == b'\r' && next == Some(b'\n') { 2 } else { 1 }
            }
            _ => {
                out.push(byte);
                1
            }
        };
        at += len;
    }
    out.push(new_quote);
    out
}

/// `UNESCAPED_LINEBREAK_PATTERN.test(raw)`, for the text of a template as it is written.
/// `is_normalized`: the parser gives `\r\n` as `\n`.
fn has_unescaped_linebreak(raw: &[u8], is_normalized: bool) -> bool {
    let mut at = 0;
    while let Some(found) = raw.get(at..).and_then(|rest| strings::index_of_any(rest, b"\\\r\n\xE2")) {
        at += found;
        at += match raw.get(at..) {
            Some([b'\\', b'\r', b'\n', ..]) if is_normalized => 3,
            Some([b'\\', ..]) => 2,
            Some([0xE2, 0x80, 0xA8 | 0xA9, ..] | [b'\r' | b'\n', ..]) => return true,
            _ => 1,
        };
    }
    false
}

/// ESLint's `isDirective` of this rule: it looks like a directive, wherever it is.
fn is_directive(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Expr(e)
        if e.tag() == ExprTag::String && !ast_utils::is_parenthesised(e))
}

/// ESLint's `isExpressionInOrJustAfterDirectivePrologue`, for the statement that the expression is.
fn is_in_or_just_after_directive_prologue(statement: Stmt) -> bool {
    if !ast_utils::is_top_level_expression_statement(statement) {
        return false;
    }
    let siblings = match statement.parent() {
        Node::File(file) => Some(file.body()),
        Node::Func(func) => func.body_statements(),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Module(module) => Some(module.innermost().body()),
            _ => None,
        },
        _ => None,
    };
    let mut siblings = siblings.into_iter().flatten();
    siblings.find(|it| *it == statement || !is_directive(*it)) == Some(statement)
}

impl Quotes {
    #[inline]
    fn wants_backticks(&self) -> bool {
        self.quote == b'`'
    }

    /// `literal`: what can be a string in quotes, which is a `Literal` for ESLint.
    /// `is_allowed_as_non_backtick`: a template cannot be written there.
    fn check_literal(&self, literal: Span, is_allowed_as_non_backtick: bool, cx: &Cx<'_, Self>) {
        let raw = cx.slice(literal);
        let Some(&first @ (b'"' | b'\'')) = raw.first() else {
            return;
        };
        if first == self.quote
            || self.wants_backticks() && is_allowed_as_non_backtick
            || self.avoids_escape
                && first == self.alternate_quote
                && strings::contains_char(raw, self.quote)
        {
            return;
        }
        cx.report(literal, WRONG_QUOTES).data("description", self.description).fix(|fixer| {
            // A template cannot have these.
            let is_fixable = !self.wants_backticks()
                || !ast_utils::has_octal_or_non_octal_decimal_escape_sequence(raw);
            is_fixable.then(|| fixer.replace(literal, convert(raw, self.quote)))
        });
    }

    /// `template`: a template without substitutions and without a tag. `e`: the expression, if it
    /// is one.
    fn check_template<'a>(&self, template: Span, e: Option<Expr<'a>>, cx: &Cx<'a, Self>) {
        if self.allows_template_literals || self.wants_backticks() {
            return;
        }
        let is_normalized = cx.is_javascript() && cx.language().parser != Parser::TypeScript;
        if has_unescaped_linebreak(cx.slice(template.shrink(1, 1)), is_normalized) {
            return;
        }
        cx.report(template, WRONG_QUOTES).data("description", self.description).fix(|fixer| {
            // As a string it could become a directive.
            let is_statement = e.is_some_and(|e| {
                matches!(e.parent(), Node::Stmt(it) if ast_utils::is_top_level_expression_statement(it))
                    && !ast_utils::is_parenthesised(e)
            });
            (!is_statement).then(|| fixer.replace(template, convert(fixer.file().slice(template), self.quote)))
        });
    }

    /// `is_property`: the key is that of a `Property`, a `PropertyDefinition` or a
    /// `MethodDefinition`.
    fn check_key<'a>(&self, key: Option<Key<'a>>, is_property: bool, cx: &Cx<'a, Self>) {
        let Some(key) = key else {
            return;
        };
        match key.kind() {
            KeyKind::String(_) => self.check_literal(key.inner_span(cx.file()), is_property, cx),
            KeyKind::ComputedString(_) => {
                let span = key.inner_span(cx.file());
                match cx.slice(span).starts_with(b"`") {
                    true => self.check_template(span, None, cx),
                    false => self.check_literal(span, false, cx),
                }
            }
            _ => {}
        }
    }

    fn check_string<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let span = e.span();
        match cx.text().get(span.start as usize) {
            Some(&first @ (b'"' | b'\'')) if first != self.quote => {}
            _ => return,
        }
        if e.is_jsx_text() {
            return;
        }
        let is_allowed_as_non_backtick = match e.parent() {
            // ESLint's `isJSXLiteral`
            Node::Prop(prop) if prop.is_jsx_attribute() && e.jsx_container_span().is_none() => return,
            Node::Stmt(statement) if self.wants_backticks() => {
                !ast_utils::is_parenthesised(e) && is_in_or_just_after_directive_prologue(statement)
            }
            _ => false,
        };
        self.check_literal(span, is_allowed_as_non_backtick, cx);
    }

    fn check_template_literal<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Template(template) = e.kind() else {
            return;
        };
        let has_tag = || {
            matches!(e.parent(), Node::Expr(parent)
                if matches!(parent.kind(), ExprKind::TaggedTemplate(call) if call.template() == Some(e)))
        };
        if template.exprs().is_empty() && !has_tag() {
            self.check_template(e.span(), Some(e), cx);
        }
    }

    fn check_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if !member.flags().contains(Flags::STRING_NAME) {
            return;
        }
        let is_property =
            !member.is_signature() && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR);
        match member.constructor_keyword() {
            Some(keyword) => self.check_literal(keyword.span(), is_property, cx),
            None => self.check_key(member.key(), is_property, cx),
        }
    }

    fn check_type<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        match ty.kind() {
            TypeKind::StringLit(_) if ty.text().starts_with(b"`") => self.check_template(ty.span(), None, cx),
            TypeKind::StringLit(_) => self.check_literal(ty.span(), false, cx),
            TypeKind::Import { .. } => {
                if let Some(source) = ty.import_source_span() {
                    self.check_literal(source, false, cx);
                }
                // These are in an `ObjectExpression`.
                for entry in ty.import_attributes().into_iter().flat_map(ImportAttributes::entries) {
                    self.check_key(entry.key(), true, cx);
                }
            }
            _ => {}
        }
    }

    /// The names and the module specifiers that are written as strings.
    fn check_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let is_require = match statement.kind() {
            StmtKind::ExportStar { alias, .. } => {
                if let Some(alias) = alias {
                    self.check_literal(alias.span(), true, cx);
                }
                false
            }
            StmtKind::Module(module) => {
                self.check_literal(module.name_span(), false, cx);
                return;
            }
            StmtKind::ImportEquals(_) => true,
            _ => false,
        };
        if let Some(specifier) = statement.module_specifier_span() {
            self.check_literal(specifier, !is_require, cx);
        }
        for entry in statement.import_attributes().into_iter().flat_map(ImportAttributes::entries) {
            self.check_key(entry.key(), false, cx);
        }
    }
}

impl Rule for Quotes {
    const META: Meta = Meta::eslint("quotes", Kind::Layout).fixable(Fixable::Code).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let (quote, alternate_quote, description) = match options.str(0) {
            Some("single") => (b'\'', b'"', "singlequote"),
            Some("backtick") => (b'`', b'"', "backtick"),
            _ => (b'"', b'\'', "doublequote"),
        };
        let object = options.object(1);
        Quotes {
            quote,
            alternate_quote,
            description,
            avoids_escape: options.str(1) == Some("avoid-escape") || object.bool_or("avoidEscape", false),
            allows_template_literals: object.bool_or("allowTemplateLiterals", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let other_quotes: &[u8] = match self.quote {
            b'"' => b"'`",
            b'\'' => b"\"`",
            _ => b"\"'",
        };
        if strings::index_of_any(file.text(), other_quotes).is_none() {
            return;
        }
        on.exprs([ExprTag::String], Self::check_string);
        if !self.allows_template_literals && !self.wants_backticks() {
            on.exprs([ExprTag::Template], Self::check_template_literal);
        }
        // TODO(api): replace by utils::string_literals
        // The strings and the templates that are nodes for ESLint and not expressions here.
        on.props(|rule, prop, cx| rule.check_key(prop.key(), true, cx));
        on.members(Self::check_member);
        on.enum_members(|rule, member, cx| rule.check_key(member.key(), false, cx));
        on.pats([PatTag::Object], |rule, pat, cx| {
            if let PatKind::Object(props) = pat.kind() {
                props.iter().for_each(|prop| rule.check_key(prop.key(), true, cx));
            }
        });
        on.types([TypeTag::StringLit, TypeTag::Import], Self::check_type);
        on.import_specs(|rule, spec, cx| rule.check_literal(spec.imported().span(), true, cx));
        // Without an `as`, ESLint comes by the one name twice: as `local` and as `exported`.
        on.export_specs(|rule, spec, cx| {
            rule.check_literal(spec.local().span(), true, cx);
            rule.check_literal(spec.exported().span(), true, cx);
        });
        on.stmts(
            [
                StmtTag::Import,
                StmtTag::ExportNamed,
                StmtTag::ExportStar,
                StmtTag::ImportEquals,
                StmtTag::Module,
            ],
            Self::check_statement,
        );
    }
}
