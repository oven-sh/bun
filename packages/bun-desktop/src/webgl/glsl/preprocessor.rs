//! Directives and macros.

use std::rc::Rc;

use super::lexer::{Kind, Known, Name, Names, Token, integer};
use super::{EXTENSIONS, Error, Extensions, MAX_DEPTH, Result};

const MAX_TOKENS: usize = 1 << 21;

struct Macro {
    /// `None` if it is no function.
    parameters: Option<Vec<Name>>,
    body: Vec<Token>,
    is_predefined: bool,
}

enum Pending {
    Token(Token),
    EndOf(Name),
}

struct Conditional {
    is_skipped: bool,
    /// No other group is wanted.
    is_settled: bool,
    has_else: bool,
}

pub struct Output {
    /// The last one is `Kind::End`.
    pub tokens: Vec<Token>,
    pub is_es3: bool,
    pub extensions: Extensions,
    pub is_all_invariant: bool,
}

struct Preprocessor<'a, 'b> {
    names: &'b mut Names<'a>,
    rest: &'b [Token],
    is_at_start_of_line: bool,
    macros: Vec<Option<Rc<Macro>>>,
    is_expanding: Vec<bool>,
    pending: Vec<Pending>,
    conditionals: Vec<Conditional>,
    line_offset: u32,
    file: i32,
    budget: usize,
    depth: usize,
    available: Extensions,
    output: Output,
}

pub fn run<'a>(
    tokens: &[Token],
    names: &mut Names<'a>,
    takes_es3: bool,
    available: Extensions,
) -> Result<Output> {
    let output = Output {
        tokens: Vec::with_capacity(tokens.len()),
        is_es3: false,
        extensions: 0,
        is_all_invariant: false,
    };
    let (macros, is_expanding, pending, conditionals) = Default::default();
    let mut it = Preprocessor {
        names,
        rest: tokens,
        is_at_start_of_line: true,
        macros,
        is_expanding,
        pending,
        conditionals,
        line_offset: 0,
        file: 0,
        budget: MAX_TOKENS,
        depth: 0,
        available,
        output,
    };
    it.version(takes_es3)?;
    loop {
        let token = it.expanded()?;
        it.output.tokens.push(token);
        if token.kind == Kind::End {
            return Ok(it.output);
        }
    }
}

impl<'a, 'b> Preprocessor<'a, 'b> {
    fn fail<T>(&self, at: Token, message: &str) -> Result<T> {
        Err(Error::new(at.line, self.names.text(at.name), message))
    }

    fn number(&mut self, value: i32, like: Token) -> Token {
        Token {
            name: self.names.number(value),
            kind: Kind::Number,
            ..like
        }
    }

    fn take_line(&mut self) -> &'b [Token] {
        let (line, rest) = self.rest.split_at(
            self.rest
                .iter()
                .position(|it| matches!(it.kind, Kind::Newline | Kind::End))
                .unwrap_or(self.rest.len()),
        );
        self.rest = rest;
        line
    }

    fn version(&mut self, takes_es3: bool) -> Result<()> {
        self.rest = &self.rest[self
            .rest
            .iter()
            .take_while(|it| it.kind == Kind::Newline)
            .count()..];
        if let [hash, version, ..] = *self.rest
            && hash.is(Known::Hash)
            && version.is(Known::Version)
        {
            let line = self.take_line();
            self.output.is_es3 = match line[2..] {
                [number] if self.names.text(number.name) == "100" => false,
                [number, es]
                    if self.names.text(number.name) == "300" && es.is(Known::Es) && takes_es3 =>
                {
                    true
                }
                _ => return self.fail(version, "this context does not know the version"),
            };
            if self.output.is_es3 && hash.line != 1 {
                return self.fail(version, "version 300 has to be asked for in line 1");
            }
        }
        let is_es3 = self.output.is_es3;
        let known = EXTENSIONS
            .iter()
            .filter(|it| it.versions[usize::from(is_es3)])
            .fold(0, |all, it| all | it.bit);
        self.available &= known;
        let available = self.available;
        let extensions = EXTENSIONS
            .iter()
            .filter(|it| it.bit & available != 0)
            .map(|it| (it.name, "1"));
        let fixed = [
            ("GL_ES", "1"),
            ("GL_FRAGMENT_PRECISION_HIGH", "1"),
            ("__VERSION__", if is_es3 { "300" } else { "100" }),
            ("__LINE__", "0"),
            ("__FILE__", "0"),
        ];
        let predefined: Vec<_> = extensions
            .chain(fixed)
            .map(|(name, value)| (self.names.intern(name), self.names.intern(value)))
            .collect();
        self.macros.resize(self.names.len(), None);
        self.is_expanding.resize(self.names.len(), false);
        for (name, value) in predefined {
            let body = vec![Token {
                name: value,
                line: 0,
                kind: Kind::Number,
                follows_space: false,
                is_final: false,
            }];
            self.macros[name.0 as usize] = Some(Rc::new(Macro {
                parameters: None,
                body,
                is_predefined: true,
            }));
        }
        Ok(())
    }

    fn macro_named(&self, token: Token) -> Option<&Rc<Macro>> {
        self.macros.get(token.name.0 as usize)?.as_ref()
    }

    fn is_skipping(&self) -> bool {
        self.conditionals.last().is_some_and(|it| it.is_skipped)
    }

    /// The next token that is not part of a directive.
    fn read(&mut self) -> Result<Token> {
        loop {
            let token = self.rest[0];
            match token.kind {
                Kind::End if !self.conditionals.is_empty() => {
                    return self.fail(token, "#endif is missing");
                }
                Kind::End => return Ok(token),
                Kind::Newline => (self.rest, self.is_at_start_of_line) = (&self.rest[1..], true),
                _ if self.is_at_start_of_line && token.is(Known::Hash) => {
                    let (line, offset) = (self.take_line(), self.line_offset);
                    self.directive(&line[1..]).map_err(|it| it.moved(offset))?;
                }
                _ if self.is_skipping() => _ = self.take_line(),
                _ => {
                    let follows_space =
                        token.follows_space || std::mem::take(&mut self.is_at_start_of_line);
                    (self.rest, self.is_at_start_of_line) = (&self.rest[1..], false);
                    return Ok(Token {
                        line: token.line.wrapping_add(self.line_offset),
                        follows_space,
                        ..token
                    });
                }
            }
        }
    }

    fn unexpanded(&mut self) -> Result<Token> {
        loop {
            match self.pending.pop() {
                Some(Pending::EndOf(name)) => self.is_expanding[name.0 as usize] = false,
                Some(Pending::Token(token)) => {
                    return Ok(Token {
                        is_final: token.is_final
                            || self.is_expanding.get(token.name.0 as usize) == Some(&true),
                        ..token
                    });
                }
                None => return self.read(),
            }
        }
    }

    fn expanded(&mut self) -> Result<Token> {
        loop {
            let token = self.unexpanded()?;
            let Some(found) = self.macro_named(token).filter(|_| !token.is_final).cloned() else {
                return Ok(token);
            };
            match token.known() {
                Known::LineMacro => return Ok(self.number(token.line as i32, token)),
                Known::FileMacro => return Ok(self.number(self.file, token)),
                _ => {}
            }
            let (mut arguments, mut line) = (Vec::new(), token.line);
            if let Some(parameters) = &found.parameters {
                let next = self.unexpanded()?;
                if !next.is(Known::LeftParen) {
                    self.pending.push(Pending::Token(next));
                    return Ok(token);
                }
                (arguments, line) = self.arguments(token, parameters.len())?;
            }
            self.pending.push(Pending::EndOf(token.name));
            self.is_expanding[token.name.0 as usize] = true;
            for part in found.body.iter().rev() {
                let before = self.pending.len();
                match found
                    .parameters
                    .iter()
                    .flatten()
                    .position(|it| *it == part.name)
                {
                    Some(at) => self
                        .pending
                        .extend(arguments[at].iter().rev().map(|it| Pending::Token(*it))),
                    None => self.pending.push(Pending::Token(Token { line, ..*part })),
                }
                self.budget = self.budget.saturating_sub(1 + self.pending.len() - before);
                if self.budget == 0 {
                    return self.fail(token, "macros expand to too much");
                }
            }
        }
    }

    /// Expanded, and the line of the closing parenthesis.
    fn arguments(&mut self, name: Token, wanted: usize) -> Result<(Vec<Vec<Token>>, u32)> {
        let (mut arguments, mut depth) = (vec![Vec::new()], 0);
        let end = loop {
            let token = self.unexpanded()?;
            match token.known() {
                _ if token.kind == Kind::End => {
                    return self.fail(name, "the arguments of the macro do not end");
                }
                Known::RightParen if depth == 0 => break token,
                Known::Comma if depth == 0 => {
                    arguments.push(Vec::new());
                    continue;
                }
                Known::LeftParen => depth += 1,
                Known::RightParen => depth -= 1,
                _ => {}
            }
            arguments
                .last_mut()
                .into_iter()
                .for_each(|it| it.push(token));
        };
        if wanted == 0 && arguments[0].is_empty() {
            arguments.remove(0);
        }
        if arguments.len() != wanted {
            return self.fail(name, "the macro has another number of parameters");
        }
        Ok((
            arguments
                .iter()
                .map(|it| self.expand_all(it, end))
                .collect::<Result<_>>()?,
            end.line,
        ))
    }

    fn expand_all(&mut self, tokens: &[Token], at: Token) -> Result<Vec<Token>> {
        self.budget = self.budget.saturating_sub(tokens.len());
        if self.depth == MAX_DEPTH || self.budget == 0 {
            return self.fail(at, "macros are nested too deeply");
        }
        let end = Token {
            name: Known::Nothing.into(),
            kind: Kind::End,
            ..at
        };
        let outer = std::mem::replace(
            &mut self.pending,
            tokens
                .iter()
                .chain([&end])
                .rev()
                .map(|it| Pending::Token(*it))
                .collect(),
        );
        self.depth += 1;
        let mut all = Vec::with_capacity(tokens.len());
        while let token = self.expanded()?
            && token.kind != Kind::End
        {
            all.push(token);
        }
        (self.depth, self.pending) = (self.depth - 1, outer);
        Ok(all)
    }

    fn directive(&mut self, line: &[Token]) -> Result<()> {
        let [directive, rest @ ..] = line else {
            return Ok(());
        };
        let (directive, known) = (*directive, directive.known());
        match known {
            Known::If | Known::Ifdef | Known::Ifndef => {
                let is_inside_skipped = self.is_skipping();
                let is_met = !is_inside_skipped
                    && if known == Known::If {
                        self.condition(directive, rest)?
                    } else {
                        self.is_defined(directive, rest)? == (known == Known::Ifdef)
                    };
                self.conditionals.push(Conditional {
                    is_skipped: !is_met,
                    is_settled: is_met || is_inside_skipped,
                    has_else: false,
                });
            }
            Known::Elif | Known::Else | Known::Endif => {
                let Some(mut it) = self.conditionals.pop() else {
                    return self.fail(directive, "there is no #if for it");
                };
                if !self.is_skipping()
                    && (known != Known::Endif && it.has_else
                        || known != Known::Elif && !rest.is_empty())
                {
                    return self.fail(directive, "nothing can follow this directive");
                }
                if known != Known::Endif {
                    let is_met = !it.is_settled
                        && (known == Known::Else || self.condition(directive, rest)?);
                    (it.is_skipped, it.is_settled, it.has_else) =
                        (!is_met, it.is_settled || is_met, known == Known::Else);
                    self.conditionals.push(it);
                }
            }
            _ if self.is_skipping() => {}
            Known::Define => self.define(directive, rest)?,
            Known::Undef => {
                if self.is_defined(directive, rest)? {
                    self.require_changeable(rest[0])?;
                    self.macros[rest[0].name.0 as usize] = None;
                }
            }
            Known::Error => {
                let words: Vec<_> = rest.iter().map(|it| self.names.text(it.name)).collect();
                return Err(Error::new(directive.line, "#error", &words.join(" ")));
            }
            Known::Pragma => {
                let wanted = [
                    Known::Stdgl,
                    Known::Invariant,
                    Known::LeftParen,
                    Known::All,
                    Known::RightParen,
                ];
                self.output.is_all_invariant |= rest.iter().map(|it| it.known()).eq(wanted);
            }
            Known::Extension => self.extension(directive, rest)?,
            Known::Line => {
                let tokens = self.expand_directive(rest, directive)?;
                let mut expression = Expression {
                    rest: &tokens,
                    names: self.names,
                    at: directive,
                    depth: 0,
                };
                let number = expression.binary(0, true)?;
                let file = if expression.rest.is_empty() {
                    self.file
                } else {
                    expression.whole()?
                };
                let next = self.rest[0].line + 1;
                (self.line_offset, self.file) = ((number as u32).wrapping_sub(next), file);
            }
            Known::Version => return self.fail(directive, "#version has to come first"),
            _ => return self.fail(directive, "unknown directive"),
        }
        Ok(())
    }

    fn expand_directive(&mut self, tokens: &[Token], at: Token) -> Result<Vec<Token>> {
        let moved: Vec<_> = tokens
            .iter()
            .map(|it| Token {
                line: it.line.wrapping_add(self.line_offset),
                ..*it
            })
            .collect();
        self.expand_all(&moved, at)
    }

    fn is_defined(&self, directive: Token, rest: &[Token]) -> Result<bool> {
        match *rest {
            [name] if name.kind == Kind::Identifier => Ok(self.macro_named(name).is_some()),
            _ => self.fail(directive, "expected a macro name"),
        }
    }

    fn require_changeable(&self, name: Token) -> Result<()> {
        match self.macro_named(name) {
            Some(it) if it.is_predefined => self.fail(name, "it is a macro of the language"),
            _ if name.is(Known::Defined) || self.names.text(name.name).starts_with("GL_") => {
                self.fail(name, "the name is reserved")
            }
            _ => Ok(()),
        }
    }

    fn define(&mut self, directive: Token, rest: &[Token]) -> Result<()> {
        let Some((&name, mut body)) = rest
            .split_first()
            .filter(|it| it.0.kind == Kind::Identifier)
        else {
            return self.fail(directive, "expected a macro name");
        };
        self.require_changeable(name)?;
        let mut parameters = None;
        if body
            .first()
            .is_some_and(|it| it.is(Known::LeftParen) && !it.follows_space)
        {
            let Some(end) = body
                .iter()
                .position(|it| it.is(Known::RightParen))
                .filter(|it| *it <= 2 * MAX_DEPTH)
            else {
                return self.fail(name, "malformed parameters");
            };
            let (list, mut all) = (&body[1..end], Vec::new());
            for part in list
                .split(|it| it.is(Known::Comma))
                .filter(|_| !list.is_empty())
            {
                match *part {
                    [it] if it.kind == Kind::Identifier && !all.contains(&it.name) => {
                        all.push(it.name)
                    }
                    _ => return self.fail(name, "malformed parameters"),
                }
            }
            (parameters, body) = (Some(all), &body[end + 1..]);
        }
        let spelling = |tokens: &[Token]| {
            tokens
                .iter()
                .enumerate()
                .map(|(at, it)| (it.name, at > 0 && it.follows_space))
                .collect::<Vec<_>>()
        };
        if self
            .macro_named(name)
            .is_some_and(|it| it.parameters != parameters || spelling(&it.body) != spelling(body))
        {
            return self.fail(name, "it was defined differently before");
        }
        self.macros[name.name.0 as usize] = Some(Rc::new(Macro {
            parameters,
            body: body.to_vec(),
            is_predefined: false,
        }));
        Ok(())
    }

    fn extension(&mut self, directive: Token, rest: &[Token]) -> Result<()> {
        let &[name, colon, behavior] = rest else {
            return self.fail(directive, "malformed #extension");
        };
        let (behavior, is_all) = (behavior.known(), name.is(Known::All));
        let is_valid = matches!(behavior, Known::Warn | Known::Disable)
            || !is_all && matches!(behavior, Known::Require | Known::Enable);
        if name.kind != Kind::Identifier || !colon.is(Known::Colon) || !is_valid {
            return self.fail(directive, "malformed #extension");
        }
        if self.output.is_es3 && !self.output.tokens.is_empty() {
            return self.fail(name, "#extension has to come before the code");
        }
        let named = || {
            EXTENSIONS
                .iter()
                .find(|it| it.name == self.names.text(name.name))
                .map_or(0, |it| it.bit)
        };
        match self.available & if is_all { !0 } else { named() } {
            0 if behavior == Known::Require => {
                return self.fail(
                    name,
                    "unknown extension, or getExtension was not called for it",
                );
            }
            bits if behavior == Known::Disable => self.output.extensions &= !bits,
            bits => self.output.extensions |= bits,
        }
        Ok(())
    }

    fn condition(&mut self, directive: Token, mut rest: &[Token]) -> Result<bool> {
        let mut tokens = Vec::with_capacity(rest.len());
        while let [first, after @ ..] = rest {
            rest = after;
            if !first.is(Known::Defined) {
                tokens.push(*first);
                continue;
            }
            let name;
            (name, rest) = match after {
                [open, name, close, after @ ..]
                    if open.is(Known::LeftParen) && close.is(Known::RightParen) =>
                {
                    (name, after)
                }
                [name, after @ ..] => (name, after),
                [] => return self.fail(directive, "expected a macro name"),
            };
            let value = if self.is_defined(directive, &[*name])? {
                "1"
            } else {
                "0"
            };
            tokens.push(Token {
                name: self.names.intern(value),
                kind: Kind::Number,
                ..*first
            });
        }
        let tokens = self.expand_directive(&tokens, directive)?;
        Ok(Expression {
            rest: &tokens,
            names: self.names,
            at: directive,
            depth: 0,
        }
        .whole()?
            != 0)
    }
}

struct Expression<'a, 'b> {
    rest: &'b [Token],
    names: &'b Names<'a>,
    at: Token,
    depth: usize,
}

impl Expression<'_, '_> {
    fn fail<T>(&self, message: &str) -> Result<T> {
        Err(Error::new(
            self.at.line,
            self.names.text(self.rest.first().unwrap_or(&self.at).name),
            message,
        ))
    }

    fn whole(&mut self) -> Result<i32> {
        let value = self.binary(0, true)?;
        if self.rest.is_empty() {
            Ok(value)
        } else {
            self.fail("it does not belong to the expression")
        }
    }

    /// What does not count can have undefined names and divide by zero.
    fn unary(&mut self, counts: bool) -> Result<i32> {
        let Some((&token, rest)) = self.rest.split_first().filter(|_| self.depth < MAX_DEPTH)
        else {
            return self.fail("malformed expression");
        };
        let number = (token.kind == Kind::Number)
            .then(|| integer(self.names.text(token.name)))
            .flatten();
        if number.is_some()
            || token.kind == Kind::Identifier && !counts && !token.is(Known::Defined)
        {
            self.rest = rest;
            return Ok(number.map_or(0, |it| it.0 as i32));
        }
        let operate: fn(i32) -> i32 = match token.known() {
            Known::Plus | Known::LeftParen => |it| it,
            Known::Minus => i32::wrapping_neg,
            Known::Tilde => |it| !it,
            Known::Not => |it| (it == 0).into(),
            _ => return self.fail("malformed expression"),
        };
        (self.rest, self.depth) = (rest, self.depth + 1);
        let value = if token.is(Known::LeftParen) {
            self.binary(0, counts)?
        } else {
            self.unary(counts)?
        };
        self.depth -= 1;
        if token.is(Known::LeftParen) {
            let Some(rest) = self
                .rest
                .split_first()
                .filter(|it| it.0.is(Known::RightParen))
            else {
                return self.fail("expected ')'");
            };
            self.rest = rest.1;
        }
        Ok(operate(value))
    }

    fn binary(&mut self, weakest: u8, counts: bool) -> Result<i32> {
        let mut left = self.unary(counts)?;
        while let Some(operator) = self.rest.first().map(|it| it.known())
            && let Some(strength) = super::parser::precedence(operator)
                .filter(|it| *it >= weakest && operator != Known::Xor)
        {
            self.rest = &self.rest[1..];
            let is_decided =
                operator == Known::And && left == 0 || operator == Known::Or && left != 0;
            let right = self.binary(strength + 1, counts && !is_decided)?;
            left = match operator {
                Known::Slash | Known::Percent if right == 0 && counts => {
                    return self.fail("division by zero");
                }
                Known::ShiftLeft | Known::ShiftRight if !(0..32).contains(&right) && counts => {
                    return self.fail("the shift is out of range");
                }
                Known::Slash | Known::Percent if right == 0 => 0,
                Known::Slash => left.wrapping_div(right),
                Known::Percent => left.wrapping_rem(right),
                Known::Star => left.wrapping_mul(right),
                Known::Plus => left.wrapping_add(right),
                Known::Minus => left.wrapping_sub(right),
                Known::ShiftLeft => left.wrapping_shl(right as u32),
                Known::ShiftRight => left.wrapping_shr(right as u32),
                Known::Less => (left < right).into(),
                Known::Greater => (left > right).into(),
                Known::LessEqual => (left <= right).into(),
                Known::GreaterEqual => (left >= right).into(),
                Known::Equal => (left == right).into(),
                Known::NotEqual => (left != right).into(),
                Known::Ampersand => left & right,
                Known::Caret => left ^ right,
                Known::Bar => left | right,
                Known::And => (left != 0 && right != 0).into(),
                _ => (left != 0 || right != 0).into(),
            };
        }
        Ok(left)
    }
}
