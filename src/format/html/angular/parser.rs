//! The parser for the expressions of Angular: `Parser` and `_ParseAST` of `@angular/compiler`.
//!
//! It accepts what Angular accepts without an error. It makes no tree: what it makes of an expression is TypeScript that
//! the parser for TypeScript reads into the tree that Angular makes of the expression. That is the text of the expression,
//! except that
//!
//! - a pipe `a | b: c : d` is `a | b( c , d)`. Angular has no bitwise operators;
//! - there are parentheses where TypeScript would group otherwise: `a => b | c` is `(a => b) | c`, `a && b ?? c` is
//!   `a && (b ?? c)`, `a + b = c` is `a + (b = c)`, `--a` is `-(-a)`, ``a?.b`c`.d`` is ``(a?.b)`c`.d``, and `a < b` is
//!   `(a < b)`, which cannot be the start of type arguments;
//! - a name that is a reserved word of TypeScript starts with `_`, and so for what else is only to be read and is written
//!   as it is in the text;
//! - there is no line break before `!`, before `=>` and after `.`.

use super::lexer::{Kind, Token, tokenize};
use bun_core::strings;

/// Angular reports an error, or the expression is nested too deeply.
#[derive(Debug, Copy, Clone)]
pub(crate) struct Failed;

pub(crate) type Parsed<T> = Result<T, Failed>;

/// An expression, as TypeScript.
#[derive(Debug)]
pub(crate) struct Expression {
    /// `(`, the expression, a line break and `)`.
    pub(crate) code: Vec<u8>,
    /// The same with every name as it is written, if that is not the same. It is as long.
    pub(crate) shown: Option<Vec<u8>>,
    /// Prettier's `hasNgSideEffect`: there is a call or an assignment in it.
    pub(crate) has_side_effect: bool,
}

/// What an expression is, as far as that says where TypeScript needs parentheses to read it as Angular does.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum Shape {
    Pipe,
    Conditional,
    Or,
    And,
    Nullish,
    /// Any other binary operator.
    Binary,
    /// `+a`, `-a`
    Sign,
    /// `!a`, `typeof a`, `void a`
    Prefix,
    Arrow,
    Assignment,
    Other,
}

#[derive(Debug, Copy, Clone)]
pub(super) struct Operand {
    pub(super) start: u32,
    pub(super) end: u32,
    shape: Shape,
}

#[derive(Debug, Copy, Clone)]
enum Change {
    /// `)` before the byte.
    Close,
    /// `(` before the byte.
    Open,
    /// Another byte in its place.
    Put(u8),
    /// Another byte in its place, which is not shown.
    Hide(u8),
}

#[derive(Debug, Copy, Clone)]
struct Edit {
    at: u32,
    change: Change,
}

/// The levels of binary operators, from the one that binds least.
const OR: u8 = 1;
const AND: u8 = 2;
const NULLISH: u8 = 3;
const EQUALITY: u8 = 4;
const RELATIONAL: u8 = 5;
const ADDITIVE: u8 = 6;
const MULTIPLICATIVE: u8 = 7;

/// Whether TypeScript does not read `name` as a name where an expression or a parameter is expected, in a module.
fn is_reserved_word(name: &[u8]) -> bool {
    matches!(
        name,
        b"as"
            | b"do"
            | b"if"
            | b"in"
            | b"for"
            | b"let"
            | b"new"
            | b"try"
            | b"var"
            | b"case"
            | b"else"
            | b"enum"
            | b"eval"
            | b"null"
            | b"this"
            | b"true"
            | b"void"
            | b"with"
            | b"await"
            | b"break"
            | b"catch"
            | b"class"
            | b"const"
            | b"false"
            | b"super"
            | b"throw"
            | b"while"
            | b"yield"
            | b"delete"
            | b"export"
            | b"import"
            | b"public"
            | b"return"
            | b"static"
            | b"switch"
            | b"typeof"
            | b"default"
            | b"extends"
            | b"finally"
            | b"package"
            | b"private"
            | b"continue"
            | b"debugger"
            | b"function"
            | b"arguments"
            | b"interface"
            | b"protected"
            | b"undefined"
            | b"implements"
            | b"instanceof"
    )
}

/// `Binary.isAssignmentOperation`
fn is_assignment_operation(operator: &[u8]) -> bool {
    matches!(
        operator,
        b"=" | b"+=" | b"-=" | b"*=" | b"/=" | b"%=" | b"**=" | b"&&=" | b"||=" | b"??="
    )
}

/// `Parser._commentStart`: where the comment starts that goes on to the end of `input`.
pub(crate) fn comment_start(input: &[u8]) -> Option<usize> {
    if !strings::contains(input, b"//") {
        return None;
    }
    let mut outer_quote = None;
    for (at, &byte) in input.iter().enumerate() {
        if byte == b'/' && input.get(at + 1) == Some(&b'/') && outer_quote.is_none() {
            return Some(at);
        }
        if outer_quote == Some(byte) {
            outer_quote = None;
        } else if outer_quote.is_none() && matches!(byte, b'\'' | b'"' | b'`') {
            outer_quote = Some(byte);
        }
    }
    None
}

pub(crate) struct Parser<'i> {
    pub(super) input: &'i [u8],
    tokens: Vec<Token>,
    odd_blanks: Vec<u32>,
    pub(super) index: usize,
    /// `parseFlags & 1`: assignments and no pipes.
    is_action: bool,
    /// What makes TypeScript of the expression that is being parsed.
    edits: Vec<Edit>,
    /// How many calls and assignments there have been.
    side_effects: u32,
    /// Where the parentheses are that have been closed last, and what is in them without parentheses of its own.
    last_parentheses: (std::ops::Range<u32>, std::ops::Range<u32>),
    stack_check: bun_core::StackCheck,
}

/// `EOF`
const END: Token = Token {
    kind: Kind::Character(0),
    start: u32::MAX,
    end: u32::MAX,
};

impl<'i> Parser<'i> {
    /// `input`: all of the text. `len`: how much of it is not a comment.
    pub(crate) fn new(
        input: &'i [u8],
        len: usize,
        is_action: bool,
        stack_check: bun_core::StackCheck,
    ) -> Self {
        let (mut tokens, mut odd_blanks) = (Vec::new(), Vec::new());
        tokenize(
            input.get(..len).unwrap_or(input),
            &mut tokens,
            &mut odd_blanks,
        );
        Parser {
            input,
            tokens,
            odd_blanks,
            index: 0,
            is_action,
            edits: Vec::new(),
            side_effects: 0,
            last_parentheses: (0..0, 0..0),
            stack_check,
        }
    }

    // ───────────────────────────── tokens ─────────────────────────────

    #[inline]
    pub(super) fn next(&self) -> Token {
        self.tokens.get(self.index).copied().unwrap_or(END)
    }

    #[inline]
    pub(super) fn is_at_end(&self) -> bool {
        self.index >= self.tokens.len()
    }

    pub(super) fn text_of(&self, token: Token) -> &'i [u8] {
        self.input
            .get(token.start as usize..token.end as usize)
            .unwrap_or_default()
    }

    /// `inputIndex`
    pub(super) fn input_index(&self) -> u32 {
        match self.tokens.get(self.index) {
            Some(next) => next.start,
            None => self.current_end_index(),
        }
    }

    /// `currentEndIndex`
    fn current_end_index(&self) -> u32 {
        match self
            .index
            .checked_sub(1)
            .and_then(|previous| self.tokens.get(previous))
        {
            Some(previous) => previous.end,
            None => self
                .tokens
                .first()
                .map_or(self.input.len() as u32, |first| first.start),
        }
    }

    #[inline]
    pub(super) fn advance(&mut self) {
        self.index += 1;
    }

    #[inline]
    fn is_character(&self, byte: u8) -> bool {
        self.next().kind == Kind::Character(byte)
    }

    fn is_operator_token(&self, token: Token, operator: &[u8]) -> bool {
        token.kind == Kind::Operator && self.text_of(token) == operator
    }

    #[inline]
    fn is_operator(&self, operator: &[u8]) -> bool {
        self.is_operator_token(self.next(), operator)
    }

    pub(super) fn is_keyword(&self, keyword: &[u8]) -> bool {
        let next = self.next();
        next.kind == Kind::Keyword && self.text_of(next) == keyword
    }

    pub(super) fn consume_optional_character(&mut self, byte: u8) -> bool {
        let is_next = self.is_character(byte);
        if is_next {
            self.advance();
        }
        is_next
    }

    pub(super) fn consume_optional_operator(&mut self, operator: &[u8]) -> bool {
        let is_next = self.is_operator(operator);
        if is_next {
            self.advance();
        }
        is_next
    }

    fn expect_character(&mut self, byte: u8) -> Parsed<()> {
        match self.consume_optional_character(byte) {
            true => Ok(()),
            false => Err(Failed),
        }
    }

    fn is_assignment_operator(&self) -> bool {
        let next = self.next();
        next.kind == Kind::Operator && is_assignment_operation(self.text_of(next))
    }

    // ───────────────────────────── TypeScript ─────────────────────────────

    fn edit(&mut self, at: u32, change: Change) {
        self.edits.push(Edit { at, change });
    }

    /// Puts `operand` in parentheses.
    fn wrap(&mut self, operand: Operand) {
        self.edit(operand.start, Change::Open);
        self.edit(operand.end, Change::Close);
    }

    /// Puts `operand` in parentheses if nothing but a comma, a colon or a bracket can be around it in TypeScript.
    fn wrap_arrow_or_assignment(&mut self, operand: Operand) {
        if matches!(operand.shape, Shape::Arrow | Shape::Assignment) {
            self.wrap(operand);
        }
    }

    /// Takes the line breaks out from before the token that is next, where TypeScript does not take one.
    fn join_with_previous_line(&mut self) {
        let (from, to) = (self.current_end_index(), self.input_index());
        for at in from..to {
            if self.input.get(at as usize) == Some(&b'\n') {
                self.edit(at, Change::Hide(b' '));
            }
        }
    }

    /// `name` is where TypeScript expects a name that is not a reserved word.
    fn hide_reserved_word(&mut self, name: Token) {
        if is_reserved_word(self.text_of(name)) {
            self.edit(name.start, Change::Hide(b'_'));
        }
    }

    /// Angular takes a line break and any escape sequence in a string. What is in it is nothing to the parser.
    fn hide_what_is_in_string(&mut self, string: Token) {
        let text = self.text_of(string);
        let mut at = 0;
        while let Some(found) = text
            .get(at..)
            .and_then(|rest| strings::index_of_any(rest, b"\\\n"))
        {
            at += found;
            self.edit(string.start + at as u32, Change::Hide(b'_'));
            at += 1;
            if text[at - 1] == b'\\' {
                if text.get(at).is_some_and(u8::is_ascii) {
                    self.edit(string.start + at as u32, Change::Hide(b'_'));
                }
                at += 1;
            }
        }
    }

    /// Angular takes `1.2.3`, `1e2e3` and `01`.
    fn hide_what_is_no_number(&mut self, number: Token) {
        let text = self.text_of(number);
        let exponent = text.iter().position(|byte| matches!(byte, b'e' | b'E'));
        let (mantissa, exponent) = text.split_at(exponent.unwrap_or(text.len()));
        let is_number = strings::count_char(mantissa, b'.') <= 1
            && !matches!(mantissa, [b'0', b'0'..=b'9' | b'_', ..])
            && !exponent
                .iter()
                .skip(1)
                .any(|byte| matches!(byte, b'e' | b'E' | b'.'));
        if !is_number {
            for at in number.start..number.end {
                self.edit(at, Change::Hide(b'1'));
            }
        }
    }

    fn operand(&self, start: u32, shape: Shape) -> Operand {
        Operand {
            start,
            end: self.current_end_index(),
            shape,
        }
    }

    /// Makes TypeScript of `operand`, which is all that has been parsed since the last call.
    pub(super) fn finish(&mut self, operand: Operand, has_side_effect: bool) -> Expression {
        let (start, end) = (operand.start, operand.end);
        let first_blank = self.odd_blanks.partition_point(|at| *at < start);
        for index in first_blank..self.odd_blanks.partition_point(|at| *at < end) {
            self.edit(self.odd_blanks[index], Change::Put(b' '));
        }
        self.edits.sort_unstable_by_key(|edit| {
            let rank = match edit.change {
                Change::Close => 0,
                Change::Open => 1,
                Change::Put(_) | Change::Hide(_) => 2,
            };
            (edit.at, rank)
        });
        let mut code = Vec::with_capacity((end - start) as usize + self.edits.len() + 3);
        code.push(b'(');
        // Where a byte is hidden, and the byte.
        let mut hidden: Vec<(usize, u8)> = Vec::new();
        let mut from = start as usize;
        for edit in self.edits.drain(..) {
            let at = edit.at as usize;
            code.extend_from_slice(self.input.get(from..at).unwrap_or_default());
            from = at;
            match edit.change {
                Change::Close => code.push(b')'),
                Change::Open => code.push(b'('),
                Change::Put(byte) => {
                    code.push(byte);
                    from = at + 1;
                }
                Change::Hide(byte) => {
                    hidden.push((code.len(), self.input.get(at).copied().unwrap_or(byte)));
                    code.push(byte);
                    from = at + 1;
                }
            }
        }
        code.extend_from_slice(self.input.get(from..end as usize).unwrap_or_default());
        code.extend_from_slice(b"\n)");
        let shown = (!hidden.is_empty()).then(|| {
            let mut shown = code.clone();
            for (at, byte) in hidden {
                shown[at] = byte;
            }
            shown
        });
        Expression {
            code,
            shown,
            has_side_effect,
        }
    }

    // ───────────────────────────── `_ParseAST` ─────────────────────────────

    /// Where `operand` is without the parentheses that all of it is in.
    fn without_parentheses(&self, operand: Operand) -> std::ops::Range<u32> {
        match self.last_parentheses.0 == (operand.start..operand.end) {
            true => self.last_parentheses.1.clone(),
            false => operand.start..operand.end,
        }
    }

    /// `parseChain`. Returns the expressions, and where the node is that `angular-estree-parser` makes of them.
    pub(crate) fn parse_chain(&mut self) -> Parsed<(Vec<Expression>, std::ops::Range<usize>)> {
        let mut expressions = Vec::new();
        let start = self.input_index();
        let mut node = start..start;
        while !self.is_at_end() {
            let side_effects = self.side_effects;
            let operand = self.parse_pipe()?;
            let has_side_effect = self.side_effects > side_effects;
            expressions.push(self.finish(operand, has_side_effect));
            node = self.without_parentheses(operand);
            if self.consume_optional_character(b';') {
                if !self.is_action {
                    return Err(Failed);
                }
                while self.consume_optional_character(b';') {}
            } else if !self.is_at_end() {
                return Err(Failed);
            }
        }
        if expressions.len() > 1 {
            node = start..self.current_end_index();
        }
        Ok((expressions, node.start as usize..node.end as usize))
    }

    pub(super) fn parse_pipe(&mut self) -> Parsed<Operand> {
        let start = self.input_index();
        let mut result = self.parse_conditional()?;
        if !self.is_operator(b"|") {
            return Ok(result);
        }
        if self.is_action {
            return Err(Failed);
        }
        if matches!(
            result.shape,
            Shape::Or | Shape::And | Shape::Nullish | Shape::Arrow | Shape::Assignment
        ) {
            self.wrap(result);
        }
        while self.consume_optional_operator(b"|") {
            let name = self.next();
            if !matches!(name.kind, Kind::Identifier | Kind::Keyword) {
                return Err(Failed);
            }
            self.hide_reserved_word(name);
            self.advance();
            let mut has_arguments = false;
            while self.is_character(b':') {
                self.edit(
                    self.next().start,
                    Change::Put(if has_arguments { b',' } else { b'(' }),
                );
                self.advance();
                has_arguments = true;
                self.parse_conditional()?;
            }
            if has_arguments {
                self.edit(self.current_end_index(), Change::Close);
            }
            result = self.operand(start, Shape::Pipe);
        }
        Ok(result)
    }

    /// `parseExpression`
    fn parse_conditional(&mut self) -> Parsed<Operand> {
        let start = self.input_index();
        let result = self.parse_binary(OR)?;
        if !self.consume_optional_operator(b"?") {
            return Ok(result);
        }
        self.parse_pipe()?;
        self.expect_character(b':')?;
        self.parse_pipe()?;
        Ok(self.operand(start, Shape::Conditional))
    }

    /// The level of the binary operator that is next.
    fn binary_level(&self) -> Option<u8> {
        let next = self.next();
        if !matches!(next.kind, Kind::Operator | Kind::Keyword) {
            return None;
        }
        Some(match (next.kind, self.text_of(next)) {
            (Kind::Operator, b"||") => OR,
            (Kind::Operator, b"&&") => AND,
            (Kind::Operator, b"??") => NULLISH,
            (Kind::Operator, b"==" | b"===" | b"!=" | b"!==") => EQUALITY,
            (Kind::Operator, b"<" | b">" | b"<=" | b">=")
            | (Kind::Keyword, b"in" | b"instanceof") => RELATIONAL,
            (Kind::Operator, b"+" | b"-") => ADDITIVE,
            (Kind::Operator, b"*" | b"%" | b"/") => MULTIPLICATIVE,
            _ => return None,
        })
    }

    /// `parseLogicalOr` down to `parseMultiplicative`: what the operators of `level` and above make.
    fn parse_binary(&mut self, level: u8) -> Parsed<Operand> {
        let start = self.input_index();
        let mut left = self.parse_exponentiation()?;
        while let Some(operator_level) = self.binary_level().filter(|it| *it >= level) {
            let operator = self.next();
            self.advance();
            let right = self.parse_binary(operator_level + 1)?;
            self.wrap_arrow_or_assignment(right);
            let shape = match operator_level {
                OR => Shape::Or,
                AND => Shape::And,
                NULLISH => Shape::Nullish,
                _ => Shape::Binary,
            };
            match operator_level {
                // TypeScript does not take `??` next to these.
                OR | AND => {
                    for operand in [left, right] {
                        if operand.shape == Shape::Nullish {
                            self.wrap(operand);
                        }
                    }
                }
                // `a--b`, `a//b/`
                ADDITIVE if right.shape == Shape::Sign => self.wrap(right),
                MULTIPLICATIVE
                    if right.start == operator.end
                        && self.input.get(right.start as usize) == Some(&b'/') =>
                {
                    self.wrap(right);
                }
                _ => {}
            }
            left = self.operand(start, shape);
            if self.text_of(operator) == b"<" {
                self.wrap(left);
            }
        }
        Ok(left)
    }

    fn parse_exponentiation(&mut self) -> Parsed<Operand> {
        let start = self.input_index();
        let mut result = self.parse_prefix()?;
        while self.is_operator(b"**") {
            if matches!(result.shape, Shape::Sign | Shape::Prefix) {
                return Err(Failed);
            }
            self.advance();
            let right = self.parse_exponentiation()?;
            self.wrap_arrow_or_assignment(right);
            result = self.operand(start, Shape::Binary);
        }
        Ok(result)
    }

    fn parse_prefix(&mut self) -> Parsed<Operand> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(Failed);
        }
        let next = self.next();
        let shape = match (next.kind, self.text_of(next)) {
            (Kind::Operator, b"+" | b"-") => Shape::Sign,
            (Kind::Operator, b"!") | (Kind::Keyword, b"typeof" | b"void") => Shape::Prefix,
            _ => return self.parse_call_chain(),
        };
        self.advance();
        let operand = self.parse_prefix()?;
        self.wrap_arrow_or_assignment(operand);
        // `--a`
        if shape == Shape::Sign && operand.shape == Shape::Sign {
            self.wrap(operand);
        }
        Ok(self.operand(next.start, shape))
    }

    fn parse_call_chain(&mut self) -> Parsed<Operand> {
        let start = self.input_index();
        let mut result = self.parse_primary()?;
        // There has been a `?.`.
        let mut is_optional_chain = false;
        loop {
            if self.consume_optional_character(b'.') {
                self.join_with_previous_line();
                result = self.parse_access_member(start, false)?;
            } else if self.consume_optional_operator(b"?.") {
                is_optional_chain = true;
                result = if self.consume_optional_character(b'(') {
                    self.parse_call(start)?
                } else if self.consume_optional_character(b'[') {
                    self.parse_keyed_read_or_write(start, true)?
                } else {
                    self.join_with_previous_line();
                    self.parse_access_member(start, true)?
                };
            } else if self.consume_optional_character(b'[') {
                result = self.parse_keyed_read_or_write(start, false)?;
            } else if self.consume_optional_character(b'(') {
                result = self.parse_call(start)?;
            } else if self.is_operator(b"!") {
                self.join_with_previous_line();
                self.advance();
                result = self.operand(start, Shape::Other);
            } else if matches!(self.next().kind, Kind::TemplateEnd | Kind::TemplatePart) {
                // To TypeScript the chain goes on behind the template.
                if std::mem::take(&mut is_optional_chain) {
                    self.wrap(result);
                }
                self.parse_template_literal()?;
                result = self.operand(start, Shape::Other);
            } else {
                return Ok(result);
            }
        }
    }

    fn parse_primary(&mut self) -> Parsed<Operand> {
        let start = self.input_index();
        if self.is_arrow_function() {
            return self.parse_arrow_function(start);
        }
        let next = self.next();
        match next.kind {
            Kind::Character(b'(') => {
                self.advance();
                let inner = self.parse_pipe()?;
                self.expect_character(b')')?;
                self.last_parentheses = (
                    start..self.current_end_index(),
                    self.without_parentheses(inner),
                );
            }
            Kind::Keyword
                if matches!(
                    self.text_of(next),
                    b"null" | b"undefined" | b"true" | b"false" | b"this"
                ) =>
            {
                self.advance();
            }
            Kind::Character(b'[') => self.parse_literal_array()?,
            Kind::Character(b'{') => self.parse_literal_map()?,
            Kind::Identifier => {
                self.hide_reserved_word(next);
                // To TypeScript, `async(...a)` and `async() :` can only be the start of an arrow function.
                if self.text_of(next) == b"async"
                    && self
                        .tokens
                        .get(self.index + 1)
                        .is_some_and(|it| it.kind == Kind::Character(b'('))
                {
                    self.edit(next.start, Change::Hide(b'_'));
                }
                return self.parse_access_member(start, false);
            }
            Kind::Number => {
                self.hide_what_is_no_number(next);
                self.advance();
            }
            Kind::String => {
                self.hide_what_is_in_string(next);
                self.advance();
            }
            Kind::TemplateEnd | Kind::TemplatePart => self.parse_template_literal()?,
            Kind::RegExpBody => self.parse_regular_expression_literal()?,
            _ => return Err(Failed),
        }
        Ok(self.operand(start, Shape::Other))
    }

    /// `...` and what is spread, or an expression.
    fn parse_spread_element_or_pipe(&mut self) -> Parsed<()> {
        self.consume_optional_operator(b"...");
        self.parse_pipe().map(|_| ())
    }

    fn parse_literal_array(&mut self) -> Parsed<()> {
        self.advance();
        while !self.is_character(b']') {
            self.parse_spread_element_or_pipe()?;
            if !self.consume_optional_character(b',') {
                break;
            }
        }
        self.expect_character(b']')
    }

    fn parse_literal_map(&mut self) -> Parsed<()> {
        self.advance();
        if self.consume_optional_character(b'}') {
            return Ok(());
        }
        loop {
            if self.is_operator(b"...") {
                self.parse_spread_element_or_pipe()?;
            } else {
                let key = self.next();
                self.advance();
                match key.kind {
                    Kind::String => {
                        self.hide_what_is_in_string(key);
                        self.expect_character(b':')?;
                        self.parse_pipe()?;
                    }
                    Kind::Identifier | Kind::Keyword => match self.consume_optional_character(b':')
                    {
                        true => {
                            self.parse_pipe()?;
                        }
                        false => self.hide_reserved_word(key),
                    },
                    _ => return Err(Failed),
                }
            }
            if !self.consume_optional_character(b',') || self.is_character(b'}') {
                break;
            }
        }
        self.expect_character(b'}')
    }

    /// The name of a property, which is next. `start`: where what it is a property of starts, or the name.
    fn parse_access_member(&mut self, start: u32, is_safe: bool) -> Parsed<Operand> {
        if !matches!(self.next().kind, Kind::Identifier | Kind::Keyword) {
            return Err(Failed);
        }
        self.advance();
        if !self.is_assignment_operator() {
            return Ok(self.operand(start, Shape::Other));
        }
        if is_safe || !self.is_action {
            return Err(Failed);
        }
        self.parse_assigned_value(start)
    }

    /// The operator of an assignment, which is next, and the value.
    fn parse_assigned_value(&mut self, start: u32) -> Parsed<Operand> {
        self.advance();
        self.parse_conditional()?;
        self.side_effects += 1;
        Ok(self.operand(start, Shape::Assignment))
    }

    /// The arguments, after the `(`.
    fn parse_call(&mut self, start: u32) -> Parsed<Operand> {
        if !self.is_character(b')') {
            loop {
                self.parse_spread_element_or_pipe()?;
                if !self.consume_optional_character(b',') {
                    break;
                }
            }
        }
        self.expect_character(b')')?;
        self.side_effects += 1;
        Ok(self.operand(start, Shape::Other))
    }

    /// The key, after the `[`.
    fn parse_keyed_read_or_write(&mut self, start: u32, is_safe: bool) -> Parsed<Operand> {
        self.parse_pipe()?;
        self.expect_character(b']')?;
        if !self.is_assignment_operator() {
            return Ok(self.operand(start, Shape::Other));
        }
        match is_safe {
            true => Err(Failed),
            false => self.parse_assigned_value(start),
        }
    }

    /// `parseTemplateLiteral`, `parseNoInterpolationTemplateLiteral`
    fn parse_template_literal(&mut self) -> Parsed<()> {
        while !self.is_at_end() {
            let token = self.next();
            self.advance();
            match token.kind {
                Kind::TemplatePart => {}
                Kind::TemplateEnd => break,
                Kind::Operator if self.text_of(token) == b"${" => {
                    self.parse_pipe()?;
                }
                // The end of what is interpolated.
                Kind::Character(b'}')
                    if matches!(self.next().kind, Kind::TemplatePart | Kind::TemplateEnd)
                        && self.next().start == token.end => {}
                // Angular passes over anything else.
                _ => {
                    for at in token.start..token.end {
                        self.edit(at, Change::Put(b' '));
                    }
                }
            }
        }
        Ok(())
    }

    fn parse_regular_expression_literal(&mut self) -> Parsed<()> {
        self.advance();
        let flags = self.next();
        if flags.kind != Kind::RegExpFlags {
            return Ok(());
        }
        self.advance();
        let mut seen = [false; 128];
        for &flag in self.text_of(flags) {
            if !matches!(flag, b'd' | b'g' | b'i' | b'm' | b's' | b'u' | b'v' | b'y')
                || seen[usize::from(flag)]
            {
                return Err(Failed);
            }
            seen[usize::from(flag)] = true;
        }
        Ok(())
    }

    fn is_arrow_function(&self) -> bool {
        let rest = self.tokens.get(self.index..).unwrap_or_default();
        match rest {
            [first, second, ..] if first.kind == Kind::Identifier => {
                self.is_operator_token(*second, b"=>")
            }
            [first, rest @ ..] if first.kind == Kind::Character(b'(') => {
                let parameters = rest
                    .iter()
                    .take_while(|it| matches!(it.kind, Kind::Identifier | Kind::Character(b',')))
                    .count();
                matches!(rest.get(parameters..), Some([close, arrow, ..])
                    if close.kind == Kind::Character(b')') && self.is_operator_token(*arrow, b"=>"))
            }
            _ => false,
        }
    }

    fn parse_arrow_function(&mut self, start: u32) -> Parsed<Operand> {
        if !self.consume_optional_character(b'(') {
            self.hide_reserved_word(self.next());
            self.advance();
        } else if !self.consume_optional_character(b')') {
            loop {
                let parameter = self.next();
                if parameter.kind != Kind::Identifier {
                    return Err(Failed);
                }
                self.hide_reserved_word(parameter);
                self.advance();
                if self.consume_optional_character(b')') {
                    break;
                }
                self.expect_character(b',')?;
            }
        }
        self.join_with_previous_line();
        if !self.consume_optional_operator(b"=>") || self.is_character(b'{') {
            return Err(Failed);
        }
        let is_action = std::mem::replace(&mut self.is_action, true);
        let body = self.parse_conditional();
        self.is_action = is_action;
        body?;
        Ok(self.operand(start, Shape::Arrow))
    }
}
