//! The parser for Angular expressions: `Parser` and `_ParseAST` in `@angular/compiler`.
//!
//! It accepts exactly what Angular accepts without an error. It doesn't build a tree. Instead it rewrites the
//! expression into TypeScript that the TypeScript parser reads into the same tree Angular would build. That's the
//! expression's text, except that
//!
//! - a pipe `a | b: c : d` becomes `a | b( c , d)`, which is safe because Angular has no bitwise operators;
//! - parentheses are added where TypeScript would group differently: `a => b | c` becomes `(a => b) | c`, `a && b ?? c`
//!   becomes `a && (b ?? c)`, `a + b = c` becomes `a + (b = c)`, `--a` becomes `-(-a)`, ``a?.b`c`.d`` becomes
//!   ``(a?.b)`c`.d``, and `a < b` becomes `(a < b)`, which can't be the start of type arguments;
//! - anything TypeScript rejects is replaced with something of the same length that it accepts: a name that's a
//!   reserved word starts with `_`, a line break before `!`, before `=>` or after `.` becomes a space, `1.2.3` becomes
//!   `11111`, and an escape sequence or a line break in a string becomes `_`.
//!
//! Names, numbers and strings are printed as they are in the source, not as they're parsed. The JavaScript formatter
//! reads them from a second text, the `display_code` field of `Code::TypeScript`.

use super::lexer::{Kind, Token, tokenize};
use bun_core::strings;

/// Angular reports an error, or the expression is nested too deeply.
#[derive(Debug, Copy, Clone)]
pub(crate) struct Failed;

pub(crate) type Parsed<T> = Result<T, Failed>;

/// The code to write for an expression.
#[derive(Debug)]
pub(crate) enum Code {
    /// Prettier's output, for an expression whose document is a single string.
    Printed(Vec<u8>),
    TypeScript {
        /// `(`, the expression, a line break and `)`.
        code: Vec<u8>,
        /// A copy of `code` with the same length, for code that prints or inspects the source text: every name is as
        /// written, and the added parentheses are spaces. `None` if it would equal `code`.
        display_code: Option<Vec<u8>>,
    },
}

#[derive(Debug)]
pub(crate) struct Expression {
    pub(crate) code: Code,
    /// Prettier's `hasNgSideEffect`: it contains a call or an assignment.
    pub(crate) has_side_effect: bool,
}

/// The kind of an expression, as far as it matters for where TypeScript needs parentheses to group it like Angular.
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
    /// Insert `)` before the byte, to end the arguments of a pipe.
    EndArguments,
    /// Insert `)` before the byte. It's a space in `display_code`, so code that looks at what follows an expression
    /// sees the source text.
    Close,
    /// Insert `(` before the byte. It's a space in `display_code`.
    Open,
    /// Replace the byte.
    Put(u8),
    /// Replace the byte, but keep showing the original.
    Hide(u8),
}

#[derive(Debug, Copy, Clone)]
struct Edit {
    at: u32,
    change: Change,
}

/// Precedence levels of the binary operators, lowest first.
const OR: u8 = 1;
const AND: u8 = 2;
const NULLISH: u8 = 3;
const EQUALITY: u8 = 4;
const RELATIONAL: u8 = 5;
const ADDITIVE: u8 = 6;
const MULTIPLICATIVE: u8 = 7;

/// True if TypeScript doesn't accept `name` as an identifier where it expects an expression or a parameter in a module.
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

/// `Parser._commentStart`: returns the start of the comment that runs to the end of `input`.
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
    angular_only_whitespace: Vec<u32>,
    pub(super) index: usize,
    /// `parseFlags & 1`: assignments are allowed and pipes aren't.
    is_action: bool,
    /// The edits that turn the expression being parsed into TypeScript.
    edits: Vec<Edit>,
    /// The number of calls and assignments parsed so far.
    side_effects: u32,
    /// The span of the most recently closed parentheses, and the span of their contents with any nested parentheses
    /// stripped.
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
    /// `input` is the whole text, and `len` is how much of it isn't a comment.
    pub(crate) fn new(
        input: &'i [u8],
        len: usize,
        is_action: bool,
        stack_check: bun_core::StackCheck,
    ) -> Self {
        let (mut tokens, mut angular_only_whitespace) = (Vec::new(), Vec::new());
        tokenize(
            input.get(..len).unwrap_or(input),
            &mut tokens,
            &mut angular_only_whitespace,
        );
        Parser {
            input,
            tokens,
            angular_only_whitespace,
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

    /// Wraps `operand` in parentheses.
    fn wrap(&mut self, operand: Operand) {
        self.edit(operand.start, Change::Open);
        self.edit(operand.end, Change::Close);
    }

    /// Wraps `operand` in parentheses if, in TypeScript, only a comma, a colon or a bracket can be next to it.
    fn wrap_arrow_or_assignment(&mut self, operand: Operand) {
        if matches!(operand.shape, Shape::Arrow | Shape::Assignment) {
            self.wrap(operand);
        }
    }

    /// Removes the line breaks before the next token, for a place where TypeScript doesn't allow one.
    fn join_with_previous_line(&mut self) {
        let (from, to) = (self.current_end_index(), self.input_index());
        for at in from..to {
            if self.input.get(at as usize) == Some(&b'\n') {
                self.edit(at, Change::Hide(b' '));
            }
        }
    }

    /// Call where TypeScript expects `name` to be an identifier that isn't a reserved word.
    fn hide_reserved_word(&mut self, name: Token) {
        if is_reserved_word(self.text_of(name)) {
            self.edit(name.start, Change::Hide(b'_'));
        }
    }

    /// Angular accepts a line break and any escape sequence in a string. The parser doesn't care about a string's
    /// contents.
    fn hide_string_contents(&mut self, string: Token) {
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

    /// Angular accepts `1.2.3`, `1e2e3` and `01`.
    fn hide_invalid_number(&mut self, number: Token) {
        let text = self.text_of(number);
        let exponent = strings::index_of_any(text, b"eE");
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

    /// Returns Prettier's output for the expression `tokens` if its document is only strings: `a`, `a.b`, `a()`,
    /// `a.b()`, a keyword literal or digits, after any number of `!`. A member access after anything but a name can go
    /// on its own line, and so can one after `a.b`.
    fn printed(&self, tokens: &[Token]) -> Option<Vec<u8>> {
        let negations = tokens
            .iter()
            .take_while(|it| self.is_operator_token(**it, b"!"))
            .count();
        let is_name = |token: &Token| matches!(token.kind, Kind::Identifier | Kind::Keyword);
        let without_call = match tokens.get(negations..)? {
            [callee @ .., open, close]
                if open.kind == Kind::Character(b'(') && close.kind == Kind::Character(b')') =>
            {
                callee
            }
            [literal] if literal.kind == Kind::Keyword => return Some(self.concatenated(tokens)),
            [number] if number.kind == Kind::Number => {
                return self
                    .text_of(*number)
                    .iter()
                    .all(u8::is_ascii_digit)
                    .then(|| self.concatenated(tokens));
            }
            all => all,
        };
        let is_printed = match without_call {
            [name] => name.kind == Kind::Identifier,
            [object, dot, property] => {
                object.kind == Kind::Identifier
                    && dot.kind == Kind::Character(b'.')
                    && is_name(property)
            }
            _ => false,
        };
        is_printed.then(|| self.concatenated(tokens))
    }

    fn concatenated(&self, tokens: &[Token]) -> Vec<u8> {
        let mut text = Vec::new();
        for token in tokens {
            text.extend_from_slice(self.text_of(*token));
        }
        text
    }

    /// Turns `operand` into TypeScript. It must cover everything parsed since the last call, which is the tokens from
    /// `first_token` on.
    pub(super) fn finish(
        &mut self,
        first_token: usize,
        operand: Operand,
        has_side_effect: bool,
    ) -> Expression {
        if let Some(printed) = self
            .tokens
            .get(first_token..self.index)
            .and_then(|tokens| self.printed(tokens))
        {
            self.edits.clear();
            return Expression {
                code: Code::Printed(printed),
                has_side_effect,
            };
        }
        let (start, end) = (operand.start, operand.end);
        let first_whitespace = self
            .angular_only_whitespace
            .partition_point(|at| *at < start);
        for index in first_whitespace..self.angular_only_whitespace.partition_point(|at| *at < end)
        {
            self.edit(self.angular_only_whitespace[index], Change::Put(b' '));
        }
        crate::sort::sort_by_key(&mut self.edits[..], |edit| {
            let rank = match edit.change {
                Change::EndArguments | Change::Close => 0,
                Change::Open => 1,
                Change::Put(_) | Change::Hide(_) => 2,
            };
            (edit.at, rank)
        });
        let mut code = Vec::with_capacity((end - start) as usize + self.edits.len() + 3);
        code.push(b'(');
        // The offset of each hidden byte, and the byte to show there.
        let mut hidden: Vec<(usize, u8)> = Vec::new();
        let mut from = start as usize;
        for edit in self.edits.drain(..) {
            let at = edit.at as usize;
            code.extend_from_slice(self.input.get(from..at).unwrap_or_default());
            from = at;
            match edit.change {
                Change::EndArguments => code.push(b')'),
                Change::Close => {
                    hidden.push((code.len(), b' '));
                    code.push(b')');
                }
                Change::Open => {
                    hidden.push((code.len(), b' '));
                    code.push(b'(');
                }
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
        let display_code = (!hidden.is_empty()).then(|| {
            let mut display_code = code.clone();
            for (at, byte) in hidden {
                display_code[at] = byte;
            }
            display_code
        });
        Expression {
            code: Code::TypeScript { code, display_code },
            has_side_effect,
        }
    }

    // ───────────────────────────── `_ParseAST` ─────────────────────────────

    /// Returns `operand`'s span without the parentheses that enclose all of it.
    fn without_parentheses(&self, operand: Operand) -> std::ops::Range<u32> {
        match self.last_parentheses.0 == (operand.start..operand.end) {
            true => self.last_parentheses.1.clone(),
            false => operand.start..operand.end,
        }
    }

    /// `parseChain`. Returns the expressions, and the span of the node that `angular-estree-parser` builds from them.
    pub(crate) fn parse_chain(&mut self) -> Parsed<(Vec<Expression>, std::ops::Range<usize>)> {
        let mut expressions = Vec::new();
        let start = self.input_index();
        let mut node = start..start;
        while !self.is_at_end() {
            let (first_token, side_effects) = (self.index, self.side_effects);
            let operand = self.parse_pipe()?;
            let has_side_effect = self.side_effects > side_effects;
            expressions.push(self.finish(first_token, operand, has_side_effect));
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
                self.edit(self.current_end_index(), Change::EndArguments);
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

    /// Returns the level of the next token if it's a binary operator.
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

    /// `parseLogicalOr` down to `parseMultiplicative`: parses operators of `level` and above.
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
                // TypeScript rejects `??` next to these without parentheses.
                OR | AND => {
                    for operand in [left, right] {
                        if operand.shape == Shape::Nullish {
                            self.wrap(operand);
                        }
                    }
                }
                // `a--b`, `a++b % c`, `a//b/`
                ADDITIVE if matches!(self.input.get(right.start as usize), Some(b'+' | b'-')) => {
                    self.wrap(right)
                }
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
        // The chain has a `?.` so far.
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
                // In TypeScript the optional chain would continue after the template.
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
                // In TypeScript, `async(...a)` and `async() :` can only be the start of an arrow function.
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
                self.hide_invalid_number(next);
                self.advance();
            }
            Kind::String => {
                self.hide_string_contents(next);
                self.advance();
            }
            Kind::TemplateEnd | Kind::TemplatePart => self.parse_template_literal()?,
            Kind::RegExpBody => self.parse_regular_expression_literal()?,
            _ => return Err(Failed),
        }
        Ok(self.operand(start, Shape::Other))
    }

    /// Parses `...` and the spread expression, or a plain expression.
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
                        self.hide_string_contents(key);
                        self.expect_character(b':')?;
                        self.parse_pipe()?;
                    }
                    // Angular treats it like any other string.
                    Kind::TemplateEnd => {
                        if strings::index_of_any(self.text_of(key), b"'\"\\\n").is_some() {
                            return Err(Failed);
                        }
                        self.edit(key.start, Change::Put(b'\''));
                        self.edit(key.end - 1, Change::Put(b'\''));
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

    /// Parses a property name, which is the next token. `start` is the start of the object, or of the name if there's
    /// none.
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

    /// Parses an assignment operator, which is the next token, and the value.
    fn parse_assigned_value(&mut self, start: u32) -> Parsed<Operand> {
        self.advance();
        self.parse_conditional()?;
        self.side_effects += 1;
        Ok(self.operand(start, Shape::Assignment))
    }

    /// Parses the arguments after the `(`.
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

    /// Parses the key after the `[`.
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
                // The end of an interpolation.
                Kind::Character(b'}')
                    if matches!(self.next().kind, Kind::TemplatePart | Kind::TemplateEnd)
                        && self.next().start == token.end => {}
                // Angular skips anything else.
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
        // Angular accepts `//`, which starts a comment in TypeScript. An identifier works because it's also printed
        // from `display_code`.
        let body = self.next();
        if body.end - body.start == 2 {
            self.edit(body.start, Change::Hide(b'_'));
            self.edit(body.start + 1, Change::Hide(b'_'));
        }
        // `/*` also starts a comment, and a line break ends a regular expression in TypeScript.
        for (at, &byte) in (body.start..).zip(self.text_of(body)) {
            if byte == b'\n' || (byte == b'*' && at == body.start + 1) {
                self.edit(at, Change::Hide(b'_'));
            }
        }
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
