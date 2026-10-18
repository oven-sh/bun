//! The value of `*directive`, and the parameters of a block: `parseTemplateBindings` of `@angular/compiler`, and
//! `transformTemplateBindings` of `angular-estree-parser`.

use super::lexer::Kind;
use super::parser::{Expression, Failed, Parsed, Parser};
use crate::text;

/// A node in the `body` of an `NGMicrosyntax`. A name is the `name` of an `NGMicrosyntaxKey`.
#[derive(Debug)]
pub(crate) enum Part {
    /// `NGMicrosyntaxKey`
    Key(Vec<u8>),
    /// `NGMicrosyntaxExpression`
    Expression {
        expression: Expression,
        alias: Option<Vec<u8>>,
    },
    /// `NGMicrosyntaxKeyedExpression`
    KeyedExpression {
        key: Vec<u8>,
        expression: Expression,
        alias: Option<Vec<u8>>,
    },
    /// `NGMicrosyntaxLet`
    Let {
        key: Vec<u8>,
        value: Option<Vec<u8>>,
    },
    /// `NGMicrosyntaxAs`
    As { key: Vec<u8>, alias: Vec<u8> },
}

/// `TemplateBindingIdentifier`
#[derive(Debug, Clone)]
struct Identifier {
    source: Vec<u8>,
    /// `span.start`
    start: u32,
}

/// `TemplateBinding`
#[derive(Debug)]
enum Binding {
    /// `ExpressionBinding`
    Expression {
        /// `sourceSpan.end`
        end: u32,
        key: Identifier,
        value: Option<Expression>,
    },
    /// `VariableBinding`
    Variable {
        /// `sourceSpan.start`
        start: u32,
        key: Identifier,
        value: Option<Identifier>,
    },
}

/// `name.charAt(0).toUpperCase() + name.substring(1)`, or the same with `toLowerCase`.
fn with_first_in_case(name: &[u8], is_upper: bool) -> Vec<u8> {
    let Some(first) = bstr::ByteSlice::chars(name).next() else {
        return Vec::new();
    };
    // Half of a surrogate pair has no other case.
    if first.len_utf16() > 1 || first == char::REPLACEMENT_CHARACTER {
        return name.to_vec();
    }
    let mut result = String::new();
    match is_upper {
        true => result.extend(first.to_uppercase()),
        false => result.extend(first.to_lowercase()),
    }
    let mut result = result.into_bytes();
    result.extend_from_slice(name.get(first.len_utf8()..).unwrap_or_default());
    result
}

impl Parser<'_> {
    /// What the string at `token` stands for.
    fn string_value(&self, token: super::lexer::Token, out: &mut Vec<u8>) -> Parsed<()> {
        let [_, content @ .., _] = self.text_of(token) else {
            return Err(Failed);
        };
        let mut rest = content;
        while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\\') {
            out.extend_from_slice(&rest[..at]);
            let Some((&escaped, after)) = rest[at + 1..].split_first() else {
                return Err(Failed);
            };
            rest = after;
            match escaped {
                b'n' => out.push(b'\n'),
                b'f' => out.push(0x0C),
                b'r' => out.push(b'\r'),
                b't' => out.push(b'\t'),
                b'v' => out.push(0x0B),
                b'u' => {
                    let hex = rest
                        .get(..4)
                        .and_then(|hex| std::str::from_utf8(hex).ok())
                        .ok_or(Failed)?;
                    // Half of a surrogate pair is nothing that can be written.
                    let character = u32::from_str_radix(hex, 16)
                        .ok()
                        .and_then(char::from_u32)
                        .ok_or(Failed)?;
                    out.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
                    rest = &rest[4..];
                }
                _ => out.push(escaped),
            }
        }
        out.extend_from_slice(rest);
        Ok(())
    }

    fn expect_template_binding_key(&mut self) -> Parsed<Identifier> {
        let mut source = Vec::new();
        let start = self.input_index();
        loop {
            let token = self.next();
            match token.kind {
                Kind::Identifier | Kind::Keyword => source.extend_from_slice(self.text_of(token)),
                Kind::String => self.string_value(token, &mut source)?,
                _ => return Err(Failed),
            }
            self.advance();
            if !self.consume_optional_operator(b"-") {
                return Ok(Identifier { source, start });
            }
            source.push(b'-');
        }
    }

    fn consume_statement_terminator(&mut self) {
        let _ = self.consume_optional_character(b';') || self.consume_optional_character(b',');
    }

    fn parse_as_binding(&mut self, value: &Identifier) -> Parsed<Option<Binding>> {
        if !self.is_keyword(b"as") {
            return Ok(None);
        }
        self.advance();
        let key = self.expect_template_binding_key()?;
        self.consume_statement_terminator();
        Ok(Some(Binding::Variable {
            start: value.start,
            key,
            value: Some(value.clone()),
        }))
    }

    fn parse_let_binding(&mut self) -> Parsed<Option<Binding>> {
        if !self.is_keyword(b"let") {
            return Ok(None);
        }
        let start = self.input_index();
        self.advance();
        let key = self.expect_template_binding_key()?;
        let value = match self.consume_optional_operator(b"=") {
            true => Some(self.expect_template_binding_key()?),
            false => None,
        };
        self.consume_statement_terminator();
        Ok(Some(Binding::Variable { start, key, value }))
    }

    fn parse_directive_keyword_bindings(
        &mut self,
        key: Identifier,
        bindings: &mut Vec<Binding>,
    ) -> Parsed<()> {
        self.consume_optional_character(b':');
        // `getDirectiveBoundTarget`
        let value = match self.is_at_end() || self.is_keyword(b"as") || self.is_keyword(b"let") {
            true => None,
            false => {
                let first_token = self.index;
                let operand = self.parse_pipe()?;
                Some(self.finish(first_token, operand, false))
            }
        };
        let mut end = self.input_index();
        let as_binding = self.parse_as_binding(&key)?;
        if as_binding.is_none() {
            self.consume_statement_terminator();
            end = self.input_index();
        }
        bindings.push(Binding::Expression { end, key, value });
        bindings.extend(as_binding);
        Ok(())
    }

    fn parse_template_bindings(&mut self) -> Parsed<Vec<Binding>> {
        let mut bindings = Vec::new();
        let template_key = Identifier {
            source: Vec::new(),
            start: 0,
        };
        self.parse_directive_keyword_bindings(template_key, &mut bindings)?;
        while !self.is_at_end() {
            if let Some(binding) = self.parse_let_binding()? {
                bindings.push(binding);
            } else {
                let mut key = self.expect_template_binding_key()?;
                match self.parse_as_binding(&key)? {
                    Some(binding) => bindings.push(binding),
                    None => {
                        key.source = with_first_in_case(&key.source, true);
                        self.parse_directive_keyword_bindings(key, &mut bindings)?;
                    }
                }
            }
            self.consume_statement_terminator();
        }
        Ok(bindings)
    }

    /// The `body` of the `NGMicrosyntax` that `angular-estree-parser` makes of the text.
    pub(crate) fn parse_microsyntax(&mut self) -> Parsed<Vec<Part>> {
        let mut bindings = self.parse_template_bindings()?.into_iter().peekable();
        if let Some(Binding::Expression { end, .. }) = bindings.peek()
            && bun_core::strings::trim_js_whitespace(
                self.input.get(..*end as usize).unwrap_or_default(),
            )
            .is_empty()
        {
            bindings.next();
        }
        let mut body: Vec<Part> = Vec::new();
        // The `key.source` of the binding before, if that is an `ExpressionBinding`.
        let mut last_expression_key: Option<Vec<u8>> = None;
        for (index, binding) in bindings.enumerate() {
            match binding {
                Binding::Expression { key, value, .. } => {
                    let name = with_first_in_case(&key.source, false);
                    body.push(match value {
                        None => Part::Key(name),
                        Some(expression) if index == 0 => Part::Expression {
                            expression,
                            alias: None,
                        },
                        Some(expression) => Part::KeyedExpression {
                            key: name,
                            expression,
                            alias: None,
                        },
                    });
                    last_expression_key = Some(key.source);
                }
                Binding::Variable { start, key, value } => {
                    let is_alias = matches!((&last_expression_key, &value), (Some(last), Some(value)) if *last == value.source);
                    last_expression_key = None;
                    if is_alias {
                        match body.last_mut() {
                            Some(
                                Part::Expression { alias, .. }
                                | Part::KeyedExpression { alias, .. },
                            ) => *alias = Some(key.source),
                            _ => return Err(Failed),
                        }
                        continue;
                    }
                    // `/^let\s$/.test(text.slice(start, start + 4))`
                    let is_let = (self
                        .input
                        .get(start as usize..)
                        .and_then(|rest| rest.strip_prefix(b"let")))
                    .is_some_and(text::starts_with_white_space);
                    body.push(match (is_let, value) {
                        (true, value) => Part::Let {
                            key: key.source,
                            value: value.map(|value| value.source),
                        },
                        (false, None) => return Err(Failed),
                        (false, Some(value)) => Part::As {
                            key: if value.source.is_empty() {
                                b"$implicit".to_vec()
                            } else {
                                value.source
                            },
                            alias: key.source,
                        },
                    });
                }
            }
        }
        Ok(body)
    }
}
