//! Highlights JavaScript, TypeScript, JSX and JSON.
//!
//! The tokens are those of `bun lint`, which cover the whole text whatever is wrong with it. They only tell a keyword from
//! a name from a string, so three things refine them:
//! - a walk over the tree marks each name whose place says what it is: the name of a function, a property, a type
//! - the scopes say what every other name refers to: a parameter, a class, an import that is called somewhere
//! - a name that is neither is a keyword that is only reserved in some places, like `async` or `type`

use crate::highlight::{Language, Span as TokenSpan, Spans, Token};
use bun_core::strings;
use bun_lint::ast::walk::{self, Visitor};
use bun_lint::ast::{
    Class, EntityName, Expr, ExprKind, ExprTag, File, Func, Import, Jsx, Key, KeyKind, Member,
    MemberKind, ModuleName, Node, PatKind, Prop, PropKind, Stmt, StmtKind, Template, TypeKind,
    TypeNode,
};
use bun_lint::language::{LanguageOptions, Parser};
use bun_lint::semantic::{Declaration, DeclarationKinds, Symbol};
use bun_lint::span::Span;
use bun_lint::tokens::{self, TokenKind};
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;
use std::sync::OnceLock;

pub(crate) fn highlight(code: &[u8], language: Language, spans: &mut Spans) {
    let path: &[u8] = match language {
        // An object at the start of a program would be a block.
        Language::Json => return highlight_in_parentheses(code, true, spans),
        Language::Jsx => b"a.jsx",
        Language::TypeScript => b"a.ts",
        Language::Tsx => b"a.tsx",
        _ => b"a.js",
    };
    with_file(path, code, |file| {
        Highlighter::new(file, false, 0).run(spans);
    });
}

pub(crate) fn highlight_expression(code: &[u8], spans: &mut Spans) {
    highlight_in_parentheses(code, false, spans);
}

fn highlight_in_parentheses(code: &[u8], is_json: bool, spans: &mut Spans) {
    let mut in_parentheses = Vec::with_capacity(code.len() + 2);
    in_parentheses.push(b'(');
    in_parentheses.extend_from_slice(code);
    in_parentheses.push(b')');
    with_file(b"a.ts", &in_parentheses, |file| {
        Highlighter::new(file, is_json, 1).run(spans);
    });
}

fn with_file(path: &[u8], code: &[u8], then: impl for<'a> FnOnce(&'a File<'a>)) {
    static LANGUAGE: OnceLock<LanguageOptions> = OnceLock::new();
    let language = LANGUAGE.get_or_init(|| LanguageOptions {
        parser: Parser::TypeScript,
        jsx_pragma: None,
        ..LanguageOptions::default()
    });
    let session = Session::new();
    bun_sema_parser::with_summary(
        Dialect::default(),
        (session.arena(), &session),
        path,
        None,
        code,
        // Only JSON files take an interner. Every other file has its own atoms.
        &bun_sema_parser::NoInterner,
        false,
        true,
        |hir, atoms| {
            let options = BindOptions {
                emit_standard_class_fields: true,
                before_es2020: false,
                before_es2017: false,
            };
            let mut recycled = Recycled::of_this_thread();
            let bound = bind_for_lint_in(&hir, options, atoms, &mut recycled);
            then(&File::new(path, &hir, bound, atoms, language, None));
        },
    );
}

/// What the token that starts at a position is. Of two marks for one position the first counts.
#[derive(Default)]
struct Marks {
    list: Vec<(u32, Token)>,
    next: usize,
    is_sorted: bool,
}

impl Marks {
    #[inline]
    fn add(&mut self, at: u32, token: Token) {
        self.is_sorted &= self.list.last().is_none_or(|last| last.0 <= at);
        self.list.push((at, token));
    }

    fn sort(&mut self) {
        if !self.is_sorted {
            crate::sort::sort_by_key(&mut self.list, |mark| mark.0);
        }
    }

    /// Positions are asked for in ascending order.
    #[inline]
    fn at(&mut self, at: u32) -> Option<Token> {
        while let Some(&(position, token)) = self.list.get(self.next) {
            if position >= at {
                return (position == at).then_some(token);
            }
            self.next += 1;
        }
        None
    }
}

struct Highlighter<'a> {
    file: &'a File<'a>,
    is_json: bool,
    /// The number of bytes in front of the code that aren't part of it.
    shift: u32,
    /// From the tree.
    marks: Marks,
    /// From the scopes.
    references: Marks,
    /// By [`Symbol::key`].
    symbols: Vec<Option<Token>>,
    has_enums: bool,
    /// The `import` and `export .. from` statements, where `as` renames.
    imports: Vec<Span>,
    next_import: usize,
    /// The templates whose text is in another language, like `` css`a { }` ``.
    embedded: Vec<(Template<'a>, u32, Language)>,
    next_embedded: usize,
}

/// The tokens of the text of a template. Their offsets are those of a copy with something short for each `${..}`.
struct Embedded {
    tokens: Vec<TokenSpan>,
    next: usize,
    /// Where the pieces of text start in the copy. They are asked for one after the other.
    pieces: Vec<u32>,
    next_piece: usize,
}

/// Where the tokens go.
struct Out<'s> {
    spans: &'s mut Spans,
    shift: u32,
}

impl Out<'_> {
    #[inline]
    fn add(&mut self, start: u32, end: u32, token: Token) {
        self.spans
            .add(start.saturating_sub(self.shift), end.saturating_sub(self.shift), token);
    }
}

/// `A`, `MAX_SIZE`
fn is_constant_name(name: &[u8]) -> bool {
    name.len() > 1
        && name[0].is_ascii_uppercase()
        && name
            .iter()
            .all(|&c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
}

impl<'a> Highlighter<'a> {
    fn new(file: &'a File<'a>, is_json: bool, shift: u32) -> Self {
        Highlighter {
            file,
            is_json,
            shift,
            marks: Marks {
                is_sorted: true,
                ..Marks::default()
            },
            references: Marks {
                is_sorted: true,
                ..Marks::default()
            },
            symbols: Vec::new(),
            has_enums: false,
            imports: Vec::new(),
            next_import: 0,
            embedded: Vec::new(),
            next_embedded: 0,
        }
    }

    fn run(mut self, spans: &mut Spans) {
        let file = self.file;
        if !self.is_json {
            self.symbols.resize(file.symbol_key_limit(), None);
            let mut enums = file.symbols_declared_as(DeclarationKinds::TS_ENUM_NAME);
            self.has_enums = enums.next().is_some();
        }
        walk::walk(file, &mut self);
        self.marks.sort();
        if !self.is_json {
            self.resolve_references();
        }
        self.write(spans);
    }

    // ───────────────────────────── scopes ─────────────────────────────

    fn resolve_references(&mut self) {
        let file = self.file;
        for reference in file.references() {
            let token = match reference.symbol() {
                Some(symbol) => self.token_of_symbol(symbol),
                None if reference.is_type() && !reference.is_value() => Token::Type,
                None => token_of_global(reference.name().bytes()),
            };
            self.references.add(reference.ident().start(), token);
        }
        self.references.sort();
    }

    fn token_of_symbol(&mut self, symbol: Symbol<'a>) -> Token {
        if let Some(Some(known)) = self.symbols.get(symbol.key()) {
            return *known;
        }
        let token = token_of_declaration(symbol);
        if let Some(slot) = self.symbols.get_mut(symbol.key()) {
            *slot = Some(token);
        }
        token
    }

    // ───────────────────────────── the tree ─────────────────────────────

    #[inline]
    fn mark(&mut self, at: u32, token: Token) {
        self.marks.add(at, token);
    }

    /// The `<` and the `>` around type parameters or type arguments.
    fn mark_angle_brackets(&mut self, span: Option<Span>) {
        if let Some(span) = span {
            self.mark(span.start, Token::PunctuationBracket);
            self.mark(span.end.saturating_sub(1), Token::PunctuationBracket);
        }
    }

    /// `name` is what is called, constructed or extended.
    fn mark_name_of(&mut self, name: Expr<'a>, plain: Token, member: Token) {
        let name = name.skip_type_wrappers();
        match name.tag() {
            ExprTag::Ident => self.mark(name.span().start, plain),
            ExprTag::Dot => {
                if let Some(at) = name.member_name_start() {
                    self.mark(at, member);
                }
            }
            _ => {}
        }
    }

    fn mark_decorators(&mut self, decorators: impl Iterator<Item = Expr<'a>>) {
        for decorator in decorators {
            let name = decorator.callee().unwrap_or(decorator);
            self.mark_name_of(name, Token::Decorator, Token::Decorator);
        }
    }

    fn mark_key(&mut self, key: Option<Key<'a>>, token: Token) {
        let Some(key) = key else { return };
        match key.kind() {
            KeyKind::Ident(_) | KeyKind::Private(_) => self.mark(key.span(self.file).start, token),
            KeyKind::String(_) if self.is_json => self.mark(key.span(self.file).start, token),
            _ => {}
        }
    }

    /// `A.B.C` in a type: `last` is what `C` is. What a name on its own is, the scopes say.
    fn mark_entity_name(&mut self, name: EntityName<'a>, last: Token) {
        let count = name.len();
        if count < 2 {
            return;
        }
        for (index, part) in name.parts().enumerate() {
            let token = match index + 1 == count {
                true => last,
                false => Token::Namespace,
            };
            self.mark(part.start(), token);
        }
    }

    fn expr(&mut self, e: Expr<'a>) {
        match e.tag() {
            ExprTag::Dot => {
                let Some(at) = e.member_name_start() else { return };
                let is_enum = |symbol: Symbol| {
                    let kinds = symbol.declaration_kinds();
                    kinds.contains(DeclarationKinds::TS_ENUM_NAME)
                };
                let of_enum = self.has_enums
                    && e.object().and_then(Expr::symbol).is_some_and(is_enum);
                self.mark(
                    at,
                    match of_enum {
                        true => Token::Constant,
                        false => Token::Property,
                    },
                );
            }
            // `a.b = function () {}`
            ExprTag::Assign => {
                if let Some((_, target, value)) = e.as_assign()
                    && value.tag() == ExprTag::Fn
                    && let Some(at) = target.member_name_start()
                {
                    self.mark(at, Token::FunctionMethod);
                }
            }
            ExprTag::Call | ExprTag::TaggedTemplate => {
                let Some(call) = e.as_call_like() else { return };
                self.mark_name_of(call.callee(), Token::Function, Token::FunctionMethod);
                self.mark_angle_brackets(call.type_args().angle_brackets_span());
            }
            ExprTag::New => {
                let Some(call) = e.as_call_like() else { return };
                self.mark_name_of(call.callee(), Token::Type, Token::Type);
                self.mark_angle_brackets(call.type_args().angle_brackets_span());
            }
            ExprTag::Instantiation => {
                if let ExprKind::Instantiation { type_args, .. } = e.kind() {
                    self.mark_angle_brackets(type_args.angle_brackets_span());
                }
            }
            ExprTag::As if e.is_angle_bracket_assertion() => {
                if let ExprKind::As { ty, .. } = e.kind() {
                    self.mark(e.span().start, Token::PunctuationBracket);
                    let close = tokens::skip_trivia(self.file.text(), ty.outer_span().end);
                    self.mark(close, Token::PunctuationBracket);
                }
            }
            ExprTag::ImportMeta | ExprTag::NewTarget => {
                if let Some((_, property)) = e.meta_property_spans() {
                    self.mark(property.start, Token::Property);
                }
            }
            ExprTag::Jsx => {
                if let ExprKind::Jsx(jsx) = e.kind() {
                    self.jsx(jsx);
                }
            }
            ExprTag::Template => {
                if let Some(template) = e.as_template()
                    && let Some(language) = language_of_template(e)
                {
                    self.embedded.push((template, e.span().start, language));
                }
            }
            _ => {}
        }
    }

    fn mark_tag_name(&mut self, name: Option<Expr<'a>>) {
        let Some(name) = name else { return };
        let mut part = name;
        // `<a.b.c>`
        while let Some((object, member, _)) = part.as_dot() {
            self.mark(member.start(), Token::TagComponent);
            part = object;
        }
        let start = part.span().start;
        let is_component = part.tag() == ExprTag::Ident
            && (name.tag() == ExprTag::Dot
                || !matches!(self.file.text().get(start as usize), Some(b'a'..=b'z')));
        match part.tag() {
            ExprTag::Ident if is_component => self.mark(start, Token::TagComponent),
            ExprTag::Ident => self.mark(start, Token::Tag),
            // `<a-b>`, `<a:b>`
            ExprTag::String => {
                self.mark(start, Token::Tag);
                if let Some((_, name)) = self.file.jsx_namespace_and_name(start) {
                    self.mark(name.start, Token::Tag);
                }
            }
            _ => {}
        }
    }

    /// The `{` and the `}` around an expression in JSX.
    fn mark_container(&mut self, e: Expr<'a>) {
        if let Some(span) = e.jsx_container_span() {
            self.mark(span.start, Token::PunctuationSpecial);
            self.mark(span.end.saturating_sub(1), Token::PunctuationSpecial);
        }
    }

    fn jsx(&mut self, jsx: Jsx<'a>) {
        let text = self.file.text();
        let opening = jsx.opening_span();
        self.mark(opening.start, Token::TagDelimiter);
        self.mark_tag_name(jsx.tag());
        self.mark_angle_brackets(jsx.type_args().angle_brackets_span());
        let close = opening.end.saturating_sub(1);
        if jsx.is_self_closing() {
            let slash = tokens::skip_trivia_back(text, close).saturating_sub(1);
            self.mark(slash, Token::TagDelimiter);
        }
        self.mark(close, Token::TagDelimiter);
        for child in jsx.children() {
            self.mark_container(child);
        }
        if let Some(closing) = jsx.closing_span() {
            self.mark(closing.start, Token::TagDelimiter);
            self.mark(
                tokens::skip_trivia(text, closing.start + 1),
                Token::TagDelimiter,
            );
            self.mark_tag_name(jsx.close_tag());
            self.mark(closing.end.saturating_sub(1), Token::TagDelimiter);
        }
    }

    fn attribute(&mut self, prop: Prop<'a>) {
        if prop.kind() == PropKind::Spread {
            let span = prop.span();
            self.mark(span.start, Token::PunctuationSpecial);
            return self.mark(span.end.saturating_sub(1), Token::PunctuationSpecial);
        }
        if let Some(key) = prop.key() {
            let span = key.span(self.file);
            self.mark(span.start, Token::Attribute);
            if let Some((_, name)) = self.file.jsx_namespace_and_name(span.start) {
                self.mark(name.start, Token::Attribute);
            }
        }
        let Some(value) = prop.value() else { return };
        match value.is_jsx_attribute_string() {
            true => self.mark(value.span().start, Token::String),
            false => self.mark_container(value),
        }
    }

    fn prop(&mut self, prop: Prop<'a>) {
        if prop.is_jsx_attribute() {
            return self.attribute(prop);
        }
        let token = match prop.kind() {
            PropKind::Shorthand | PropKind::Spread => return,
            PropKind::Method | PropKind::Getter | PropKind::Setter => Token::FunctionMethod,
            PropKind::Init => match prop.value().map(Expr::tag) {
                Some(ExprTag::Fn) => Token::FunctionMethod,
                _ => Token::Property,
            },
        };
        self.mark_key(prop.key(), token);
    }

    fn member(&mut self, member: Member<'a>) {
        self.mark_decorators(member.decorators());
        if let Some(keyword) = member.constructor_keyword() {
            return self.mark(keyword.start(), Token::Keyword);
        }
        let token = match member.kind() {
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter => Token::FunctionMethod,
            MemberKind::Property => match member.init().map(Expr::tag) {
                Some(ExprTag::Fn) => Token::FunctionMethod,
                _ => Token::Property,
            },
            _ => return,
        };
        self.mark_key(member.key(), token);
    }

    fn func(&mut self, func: Func<'a>) {
        if let Some(name) = func.name() {
            self.mark(name.start(), Token::Function);
        }
        self.mark_angle_brackets(func.type_params().angle_brackets_span());
    }

    fn class(&mut self, class: Class<'a>) {
        self.mark_decorators(class.decorators());
        if let Some(name) = class.name() {
            self.mark(name.start(), Token::Type);
        }
        self.mark_angle_brackets(class.type_params().angle_brackets_span());
        if let Some(extends) = class.extends() {
            self.mark_name_of(extends, Token::Type, Token::Type);
        }
        self.mark_angle_brackets(class.extends_args().angle_brackets_span());
    }

    fn mark_import_attributes(&mut self, attributes: Option<bun_lint::ast::ImportAttributes<'a>>) {
        for entry in attributes.into_iter().flat_map(|it| it.entries()) {
            self.mark_key(entry.key(), Token::Property);
        }
    }

    /// What the top level of the file declares as `name`.
    fn token_of_import(&mut self, name: bun_lint::ast::Ident<'a>) -> Token {
        match self.file.top_level_scope().get_name(name.name()) {
            Some(symbol) => self.token_of_symbol(symbol),
            None => Token::Variable,
        }
    }

    fn import(&mut self, import: Import<'a>) {
        if let Some(name) = import.default() {
            let token = self.token_of_import(name);
            self.mark(name.start(), token);
        }
        if let Some(name) = import.namespace() {
            self.mark(name.start(), Token::Namespace);
        }
        self.mark_import_attributes(import.attributes());
    }

    /// The label after the `break` or the `continue` that `stmt` starts with.
    fn mark_label_after(&mut self, stmt: Stmt<'a>, keyword: &str) {
        let after = stmt.span().start + keyword.len() as u32;
        let label = tokens::skip_trivia(self.file.text(), after);
        self.mark(label, Token::Label);
    }

    fn stmt(&mut self, stmt: Stmt<'a>) {
        match stmt.kind() {
            StmtKind::Interface(it) => {
                self.mark(it.name().start(), Token::Type);
                self.mark_angle_brackets(it.type_params().angle_brackets_span());
            }
            StmtKind::TypeAlias(it) => {
                self.mark(it.name().start(), Token::Type);
                self.mark_angle_brackets(it.type_params().angle_brackets_span());
            }
            StmtKind::Enum(it) => self.mark(it.name().start(), Token::Type),
            StmtKind::Module(module) => {
                let mut next = Some(module);
                while let Some(module) = next {
                    if let ModuleName::Ident(name) = module.name() {
                        self.mark(name.start(), Token::Namespace);
                    }
                    next = module.nested();
                }
            }
            StmtKind::Labeled { .. } => self.mark(stmt.span().start, Token::Label),
            StmtKind::Break(Some(_)) => self.mark_label_after(stmt, "break"),
            StmtKind::Continue(Some(_)) => self.mark_label_after(stmt, "continue"),
            StmtKind::Import(import) => {
                self.imports.push(stmt.span());
                self.import(import);
            }
            StmtKind::ImportEquals(it) => {
                self.mark(it.name().start(), Token::Namespace);
                if let Some(require) = it.require_span() {
                    self.mark(require.start, Token::Function);
                }
            }
            StmtKind::ExportNamed(export) => {
                self.imports.push(stmt.span());
                self.mark_import_attributes(export.attributes());
            }
            StmtKind::ExportStar { alias, .. } => {
                self.imports.push(stmt.span());
                if let Some(alias) = alias {
                    self.mark(alias.start(), Token::Namespace);
                }
            }
            _ => {}
        }
    }

    fn ty(&mut self, ty: TypeNode<'a>) {
        match ty.kind() {
            TypeKind::Keyword(_) => self.mark(ty.span().start, Token::TypeBuiltin),
            TypeKind::Ref { name, args } => {
                self.mark_entity_name(name, Token::Type);
                self.mark_angle_brackets(args.angle_brackets_span());
            }
            TypeKind::Import { name, args, .. } => {
                for part in name.parts() {
                    self.mark(part.start(), Token::Type);
                }
                self.mark_angle_brackets(args.angle_brackets_span());
            }
            TypeKind::Typeof { args, .. } | TypeKind::Heritage { args, .. } => {
                self.mark_angle_brackets(args.angle_brackets_span());
            }
            TypeKind::Predicate { .. } => {
                if let Some(parameter) = ty.predicate_param()
                    && !parameter.name().is("this")
                {
                    self.mark(parameter.start(), Token::VariableParameter);
                }
            }
            _ => {}
        }
    }

    // ───────────────────────────── tokens ─────────────────────────────

    /// Whether `at` is in an `import` or an `export .. from` statement. Positions are asked for in ascending order.
    fn is_in_import(&mut self, at: u32) -> bool {
        while let Some(span) = self.imports.get(self.next_import) {
            if at < span.end {
                return at >= span.start;
            }
            self.next_import += 1;
        }
        false
    }

    /// The tokens of the text of the template that starts at `start`, if that is in another language.
    fn embedded_at(&mut self, start: u32, spans: &Spans) -> Option<Embedded> {
        while self.embedded.get(self.next_embedded)?.1 < start {
            self.next_embedded += 1;
        }
        let &(template, at, language) = self.embedded.get(self.next_embedded)?;
        if at != start {
            return None;
        }
        // Something that can stand wherever a value can. It is short, so that a template in a `${..}` of a template, and so
        // on, is only read once.
        let hole: &[u8] = match language {
            Language::GraphQl => b" ",
            // `${a}px` is a number with a unit.
            Language::Scss => b"0",
            _ => b"_",
        };
        let (code, count) = (self.file.text(), template.quasi_count());
        let (mut text, mut pieces) = (Vec::new(), Vec::with_capacity(count));
        let mut is_unclosed = false;
        for index in 0..count {
            let span = template.quasi_span(index);
            let written = code.get(span.start as usize..span.end as usize)?;
            let (from, to, is_closed) = text_of_template_piece(written);
            if index > 0 {
                text.extend_from_slice(hole);
            }
            pieces.push(text.len() as u32);
            text.extend_from_slice(written.get(from..to)?);
            is_unclosed = !is_closed && span.end as usize + self.shift as usize >= code.len();
        }
        Some(Embedded {
            tokens: spans.tokens_of(language, &text, is_unclosed),
            next: 0,
            pieces,
            next_piece: 0,
        })
    }

    fn write(&mut self, spans: &mut Spans) {
        let file = self.file;
        let (text, shift) = (file.text(), self.shift);
        let end_of_code = (text.len() as u32).saturating_sub(shift);
        let out = &mut Out { spans, shift };
        // The templates that are open. `None`: its text is a string.
        let mut templates: Vec<Option<Embedded>> = Vec::new();
        let mut is_after_export = false;
        for token in file.tokens().with_comments() {
            let (start, end) = (token.start(), token.end());
            if start < shift || start >= end_of_code {
                continue;
            }
            // In code with errors a mark can be off, so one for punctuation only counts for punctuation.
            let (mark, punctuation_mark) = match self.marks.at(start) {
                mark @ Some(
                    Token::TagDelimiter | Token::PunctuationBracket | Token::PunctuationSpecial,
                ) => (None, mark),
                mark => (mark, None),
            };
            let written = text.get(start as usize..end as usize).unwrap_or_default();
            let was_after_export = std::mem::replace(&mut is_after_export, written == b"export");
            let kind = match token.kind() {
                TokenKind::Identifier if self.is_json => {
                    mark.unwrap_or_else(|| token_of_global(written))
                }
                // The sign of a number.
                TokenKind::Punctuator if self.is_json && matches!(written, b"-" | b"+") => {
                    Token::Number
                }
                TokenKind::Identifier | TokenKind::JsxIdentifier => {
                    match mark.or_else(|| self.references.at(start)) {
                        Some(Token::Variable) if is_constant_name(written) => Token::Constant,
                        Some(token) => token,
                        None => match contextual_keyword(written) {
                            Some(Token::KeywordOperator)
                                if written == b"as" && self.is_in_import(start) =>
                            {
                                Token::KeywordImport
                            }
                            Some(keyword) => keyword,
                            None => Token::Variable,
                        },
                    }
                }
                TokenKind::Keyword if was_after_export && written == b"default" => {
                    Token::KeywordImport
                }
                TokenKind::Keyword if written == b"with" && self.is_in_import(start) => {
                    Token::KeywordImport
                }
                TokenKind::Keyword => mark.unwrap_or_else(|| keyword(written)),
                TokenKind::PrivateIdentifier => mark.unwrap_or(Token::Property),
                TokenKind::Punctuator => punctuation_mark.unwrap_or_else(|| punctuator(written)),
                TokenKind::Boolean => mark.unwrap_or(Token::Boolean),
                TokenKind::Null => mark.unwrap_or(Token::ConstantBuiltin),
                TokenKind::Numeric => Token::Number,
                TokenKind::RegularExpression => Token::StringRegexp,
                TokenKind::String => {
                    add_with_escapes(out, written, start, mark.unwrap_or(Token::String));
                    continue;
                }
                TokenKind::Template => {
                    if written.starts_with(b"`") {
                        templates.push(self.embedded_at(start, out.spans));
                    }
                    let embedded = templates.last_mut().and_then(Option::as_mut);
                    if add_template(out, written, start, embedded) {
                        templates.pop();
                    }
                    continue;
                }
                TokenKind::JsxText => {
                    add_jsx_text(out, written, start, mark.filter(|it| *it == Token::String));
                    continue;
                }
                TokenKind::Block if written.starts_with(b"/**") && written.len() > 4 => {
                    add_doc_comment(out, file, start, end);
                    continue;
                }
                TokenKind::Line | TokenKind::Block => Token::Comment,
                TokenKind::Shebang => Token::KeywordDirective,
            };
            out.add(start, end, kind);
        }
    }
}

impl<'a> Visitor<'a> for Highlighter<'a> {
    fn enter(&mut self, node: Node<'a>) {
        match node {
            Node::Expr(e) => self.expr(e),
            Node::Stmt(stmt) => self.stmt(stmt),
            Node::Type(ty) => self.ty(ty),
            Node::Prop(prop) => self.prop(prop),
            Node::Member(member) => self.member(member),
            Node::Func(func) => self.func(func),
            Node::Class(class) => self.class(class),
            Node::Pat(pat) => {
                if let PatKind::Ident(_) = pat.kind() {
                    let token = match pat.symbol() {
                        Some(symbol) => self.token_of_symbol(symbol),
                        None => Token::Variable,
                    };
                    self.mark(pat.span().start, token);
                }
            }
            Node::PatProp(prop) => {
                if !prop.is_shorthand() {
                    self.mark_key(prop.key(), Token::Property);
                }
            }
            Node::Param(param) => self.mark_decorators(param.decorators()),
            Node::TypeParam(param) => self.mark(param.name().start(), Token::TypeParameter),
            Node::EnumMember(member) => self.mark_key(member.key(), Token::Constant),
            Node::ImportSpec(spec) => {
                let token = match spec.is_type_only() || spec.import().is_type_only() {
                    true => Token::Type,
                    false => self.token_of_import(spec.local()),
                };
                self.mark(spec.imported().start(), token);
                self.mark(spec.local().start(), token);
            }
            Node::ExportSpec(spec) => {
                if spec.export().has_from() {
                    self.mark(spec.local().start(), Token::Variable);
                }
                if spec.is_renamed() {
                    self.mark(spec.exported().start(), Token::Variable);
                }
            }
            Node::TupleElem(element) => {
                if let Some(name) = element.name() {
                    self.mark(name.start(), Token::Property);
                }
            }
            Node::File(_) | Node::PatElem(_) | Node::Case(_) | Node::VarDecl(_) => {}
        }
    }

    fn exit(&mut self, _: Node<'a>) {}
}

/// What a name is that refers to `symbol`.
fn token_of_declaration(symbol: Symbol<'_>) -> Token {
    let Some(declaration) = symbol.declarations().next() else {
        return match symbol.is_implicit_arguments() {
            true => Token::VariableBuiltin,
            false => Token::Variable,
        };
    };
    match declaration {
        Declaration::Param(_) => Token::VariableParameter,
        Declaration::Fn(_) => Token::Function,
        Declaration::Class(_)
        | Declaration::Interface(_)
        | Declaration::TypeAlias(_)
        | Declaration::Enum(_) => Token::Type,
        Declaration::EnumMember(_) => Token::Constant,
        Declaration::Module(_) | Declaration::ImportNamespace(_) | Declaration::ImportEquals(_) => {
            Token::Namespace
        }
        Declaration::TypeParam(_) => Token::TypeParameter,
        Declaration::Var(pat) => match declaration.node() {
            Some(Node::VarDecl(it)) if it.pat() == pat => match it.init().map(Expr::tag) {
                Some(ExprTag::Fn) => Token::Function,
                Some(ExprTag::Class) => Token::Type,
                _ => token_by_use(symbol),
            },
            _ => token_by_use(symbol),
        },
        Declaration::ImportSpec(spec) if spec.is_type_only() || spec.import().is_type_only() => {
            Token::Type
        }
        Declaration::ImportDefault(import) if import.is_type_only() => Token::Type,
        Declaration::ImportDefault(_) | Declaration::ImportSpec(_) => token_by_use(symbol),
        Declaration::Other => Token::Variable,
    }
}

/// Nothing in the file says what `symbol` is, but it is a function if it is called and a type if it is used as one.
fn token_by_use(symbol: Symbol<'_>) -> Token {
    for reference in symbol.references() {
        if reference.is_type() && !reference.is_value() {
            return Token::Type;
        }
        let Some(e) = reference.expr() else { continue };
        let parent = match Node::Expr(e).parent() {
            Node::Expr(parent) => parent,
            // `class A extends B`
            Node::Class(_) => return Token::Type,
            _ => continue,
        };
        match parent.kind() {
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) if call.callee() == e => {
                return Token::Function;
            }
            ExprKind::New(call) if call.callee() == e => return Token::Type,
            ExprKind::Jsx(jsx) if jsx.tag() == Some(e) => return Token::Type,
            _ => {}
        }
    }
    Token::Variable
}

/// A name that nothing in the file declares.
fn token_of_global(name: &[u8]) -> Token {
    match name {
        b"undefined" | b"NaN" | b"Infinity" => Token::ConstantBuiltin,
        b"arguments" | b"globalThis" => Token::VariableBuiltin,
        b"JSON" | b"URL" | b"CSS" => Token::Type,
        // `Promise`, `Map`, `Error`
        [b'A'..=b'Z', rest @ ..] if rest.iter().any(u8::is_ascii_lowercase) => Token::Type,
        _ => Token::Variable,
    }
}

/// A reserved word.
fn keyword(word: &[u8]) -> Token {
    match word {
        b"if" | b"else" | b"for" | b"while" | b"do" | b"switch" | b"case" | b"default"
        | b"break" | b"continue" | b"return" | b"throw" | b"try" | b"catch" | b"finally"
        | b"yield" => Token::KeywordControl,
        b"import" | b"export" => Token::KeywordImport,
        b"typeof" | b"instanceof" | b"in" | b"new" | b"delete" | b"void" => Token::KeywordOperator,
        b"static" | b"public" | b"private" | b"protected" => Token::KeywordModifier,
        b"this" | b"super" => Token::VariableBuiltin,
        _ => Token::Keyword,
    }
}

/// A word that is a keyword where it isn't a name.
fn contextual_keyword(word: &[u8]) -> Option<Token> {
    Some(match word {
        b"await" => Token::KeywordControl,
        b"from" | b"defer" | b"source" => Token::KeywordImport,
        b"as" | b"of" | b"is" | b"asserts" | b"satisfies" | b"keyof" | b"infer" | b"unique" => {
            Token::KeywordOperator
        }
        b"async" | b"get" | b"set" | b"static" | b"readonly" | b"abstract" | b"declare"
        | b"override" | b"accessor" | b"out" => Token::KeywordModifier,
        b"type" | b"namespace" | b"module" | b"global" | b"using" | b"let" | b"interface"
        | b"enum" | b"assert" => Token::Keyword,
        _ => return None,
    })
}

fn punctuator(written: &[u8]) -> Token {
    match written {
        b"(" | b")" | b"[" | b"]" | b"{" | b"}" => Token::PunctuationBracket,
        b"," | b";" | b"." | b":" | b"?." => Token::PunctuationDelimiter,
        b"@" => Token::Decorator,
        _ => Token::Operator,
    }
}

/// The length of the escape sequence that `text` starts with.
fn escape_len(text: &[u8]) -> usize {
    let digits = |from: usize, most: usize, is_digit: fn(&u8) -> bool| {
        let rest = text.get(from..).unwrap_or_default();
        from + rest.iter().take(most).take_while(|c| is_digit(c)).count()
    };
    match text.get(1) {
        None => 1,
        Some(b'x') => digits(2, 2, u8::is_ascii_hexdigit),
        Some(b'u') if text.get(2) == Some(&b'{') => {
            let end = digits(3, usize::MAX, u8::is_ascii_hexdigit);
            end + usize::from(text.get(end) == Some(&b'}'))
        }
        Some(b'u') => digits(2, 4, u8::is_ascii_hexdigit),
        Some(b'0'..=b'7') => digits(1, 3, |c| matches!(c, b'0'..=b'7')),
        Some(b'\r') if text.get(2) == Some(&b'\n') => 3,
        Some(&first) => 1 + usize::from(strings::utf8_byte_sequence_length(first)).max(1),
    }
}

/// Adds `written`, which starts at `start`, as `token`, except for its escape sequences.
fn add_with_escapes(out: &mut Out, written: &[u8], start: u32, token: Token) {
    let mut from = 0;
    while let Some(found) = strings::index_of_char_usize(&written[from..], b'\\') {
        let escape = from + found;
        let end = (escape + escape_len(&written[escape..])).min(written.len());
        out.add(start + from as u32, start + escape as u32, token);
        out.add(start + escape as u32, start + end as u32, Token::StringEscape);
        from = end;
    }
    out.add(start + from as u32, start + written.len() as u32, token);
}

/// Where the text is in `` `a${ ``, `}b${` or `` }c` ``, and whether something closes it.
fn text_of_template_piece(written: &[u8]) -> (usize, usize, bool) {
    let from = written.len().min(1);
    match written.get(from..).unwrap_or_default() {
        [.., b'$', b'{'] => (from, written.len() - 2, true),
        [.., b'`'] => (from, written.len() - 1, true),
        _ => (from, written.len(), false),
    }
}

/// Adds `` `a${ ``, `}b${` or `` }c` ``. Returns whether the template ends there.
fn add_template(
    out: &mut Out,
    written: &[u8],
    start: u32,
    embedded: Option<&mut Embedded>,
) -> bool {
    let end = start + written.len() as u32;
    let (from, to, _) = text_of_template_piece(written);
    let text = written.get(from..to).unwrap_or_default();
    let (from, to) = (start + from as u32, start + to as u32);
    let continues = end - to == 2;
    let (open, close) = (
        match written.first() {
            Some(b'}') => Token::PunctuationSpecial,
            _ => Token::String,
        },
        match continues {
            true => Token::PunctuationSpecial,
            false => Token::String,
        },
    );
    out.add(start, from, open);
    let piece = embedded.and_then(|it| {
        let in_copy = *it.pieces.get(it.next_piece)?;
        it.next_piece += 1;
        Some((it, in_copy))
    });
    match piece {
        None => add_with_escapes(out, text, from, Token::String),
        Some((embedded, in_copy)) => {
            let end_in_copy = in_copy + (to - from);
            while let Some(token) = embedded.tokens.get(embedded.next) {
                if token.start >= end_in_copy {
                    break;
                }
                // What stands for a `${..}` is a token too.
                out.add(
                    from + token.start.saturating_sub(in_copy),
                    from + token.end.min(end_in_copy).saturating_sub(in_copy),
                    token.token,
                );
                // The rest of it is behind the `${..}`.
                if token.end > end_in_copy {
                    break;
                }
                embedded.next += 1;
            }
        }
    }
    out.add(to, end, close);
    !continues
}

/// The text between tags, which stays plain but for `&amp;` and the like, or with `mark` the value of an attribute.
fn add_jsx_text(out: &mut Out, written: &[u8], start: u32, mark: Option<Token>) {
    let (mut from, mut search) = (0, 0);
    while let Some(found) = strings::index_of_char_usize(&written[search..], b'&') {
        let entity = search + found;
        let name = &written[entity + 1..];
        let len = name
            .iter()
            .take_while(|c| c.is_ascii_alphanumeric() || **c == b'#')
            .count();
        search = entity + 1;
        if len == 0 || name.get(len) != Some(&b';') {
            continue;
        }
        let end = entity + len + 2;
        if let Some(token) = mark {
            out.add(start + from as u32, start + entity as u32, token);
        }
        out.add(start + entity as u32, start + end as u32, Token::StringEscape);
        (from, search) = (end, end);
    }
    if let Some(token) = mark {
        out.add(start + from as u32, start + written.len() as u32, token);
    }
}

/// Adds the `/** .. */` from `start` to `end`, with its tags: `@param {string} name`.
fn add_doc_comment<'a>(out: &mut Out, file: &'a File<'a>, start: u32, end: u32) {
    let mut at = start;
    let mut add = |span: Span, token: Token| {
        if span.start >= at && span.end <= end && span.start < span.end {
            out.add(at, span.start, Token::CommentDoc);
            out.add(span.start, span.end, token);
            at = span.end;
        }
    };
    for tag in file.jsdoc().at(start).into_iter().flat_map(|it| it.tags()) {
        add(tag.kind.span, Token::Keyword);
        let (ty, name, _) = tag.type_name_comment();
        if let Some(ty) = ty {
            add(ty.span, Token::Type);
        }
        let token = match tag.kind.parsed() {
            b"param" | b"arg" | b"argument" => Token::VariableParameter,
            b"prop" | b"property" => Token::Property,
            b"template" => Token::TypeParameter,
            b"typedef" | b"callback" => Token::Type,
            _ => continue,
        };
        // Without the brackets of `[name = default]`.
        if let Some(name) = name
            && let Some(at) = strings::index_of(name.raw(), name.parsed())
        {
            let start = name.span.start + at as u32;
            add(Span::new(start, start + name.parsed().len() as u32), token);
        }
    }
    out.add(at, end, Token::CommentDoc);
}

/// The language of the text of the template `e`, if its tag or a comment in front of it says so.
fn language_of_template(e: Expr<'_>) -> Option<Language> {
    if crate::css::embed::is_embed_css(e) {
        return Some(Language::Scss);
    }
    if crate::html::in_js::can_be_html(e) {
        return Some(Language::Html);
    }
    let before = e.file().text().get(..e.span().start as usize)?;
    if before.trim_ascii_end().ends_with(b"/* GraphQL */") {
        return Some(Language::GraphQl);
    }
    let Node::Expr(parent) = Node::Expr(e).parent() else {
        return None;
    };
    let tag = parent.as_tagged_template()?.callee();
    match crate::css::embed::root_name_of_tag(tag)? {
        b"css" | b"styled" | b"keyframes" | b"createGlobalStyle" => Some(Language::Scss),
        b"html" | b"svg" => Some(Language::Html),
        b"gql" | b"graphql" => Some(Language::GraphQl),
        b"md" | b"markdown" => Some(Language::Markdown),
        _ => None,
    }
}
