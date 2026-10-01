//! Enough of JSON to read `tsconfig.json` (comments, trailing commas) and `package.json`.

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    /// In the order written: the order of `exports` conditions matters.
    Object(Vec<(String, Json)>),
}

impl Json {
    pub fn parse(text: &[u8]) -> Option<Json> {
        let mut p = Parser {
            text,
            at: 0,
            depth: 0,
        };
        if text.starts_with(b"\xEF\xBB\xBF") {
            p.at = 3;
        }
        let value = p.value()?;
        p.skip();
        if p.at == text.len() {
            Some(value)
        } else {
            None
        }
    }

    /// Whether there is nothing in `text` but space and comments.
    pub fn is_blank(text: &[u8]) -> bool {
        let mut p = Parser {
            text,
            at: 0,
            depth: 0,
        };
        if text.starts_with(b"\xEF\xBB\xBF") {
            p.at = 3;
        }
        p.skip();
        p.at == text.len()
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(entries) => entries.iter().find(|e| e.0 == key).map(|e| &e.1),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&[(String, Json)]> {
        match self {
            Json::Object(o) => Some(o),
            _ => None,
        }
    }
}

struct Parser<'a> {
    text: &'a [u8],
    at: usize,
    depth: u32,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.text.get(self.at).copied()
    }

    fn skip(&mut self) {
        loop {
            match self.peek() {
                Some(b' ' | b'\t' | b'\r' | b'\n') => self.at += 1,
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'/') => {
                    while !matches!(self.peek(), None | Some(b'\n')) {
                        self.at += 1;
                    }
                }
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'*') => {
                    self.at += 2;
                    while self.at < self.text.len() && !self.text[self.at..].starts_with(b"*/") {
                        self.at += 1;
                    }
                    self.at = (self.at + 2).min(self.text.len());
                }
                _ => return,
            }
        }
    }

    fn value(&mut self) -> Option<Json> {
        self.skip();
        self.depth += 1;
        if self.depth > 200 {
            return None;
        }
        let value = match self.peek()? {
            b'{' => {
                self.at += 1;
                let mut entries = Vec::new();
                loop {
                    self.skip();
                    match self.peek()? {
                        b'}' => {
                            self.at += 1;
                            break;
                        }
                        b',' => self.at += 1,
                        _ => {
                            let key = self.string()?;
                            self.skip();
                            if self.peek()? != b':' {
                                return None;
                            }
                            self.at += 1;
                            entries.push((key, self.value()?));
                        }
                    }
                }
                Json::Object(entries)
            }
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.skip();
                    match self.peek()? {
                        b']' => {
                            self.at += 1;
                            break;
                        }
                        b',' => self.at += 1,
                        _ => items.push(self.value()?),
                    }
                }
                Json::Array(items)
            }
            b'"' => Json::String(self.string()?),
            b't' if self.text[self.at..].starts_with(b"true") => {
                self.at += 4;
                Json::Bool(true)
            }
            b'f' if self.text[self.at..].starts_with(b"false") => {
                self.at += 5;
                Json::Bool(false)
            }
            b'n' if self.text[self.at..].starts_with(b"null") => {
                self.at += 4;
                Json::Null
            }
            _ => {
                let start = self.at;
                while matches!(
                    self.peek(),
                    Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
                ) {
                    self.at += 1;
                }
                Json::Number(
                    std::str::from_utf8(&self.text[start..self.at])
                        .ok()?
                        .parse()
                        .ok()?,
                )
            }
        };
        self.depth -= 1;
        Some(value)
    }

    fn string(&mut self) -> Option<String> {
        if self.peek()? != b'"' {
            return None;
        }
        self.at += 1;
        let mut out = Vec::new();
        loop {
            let c = self.peek()?;
            self.at += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = self.peek()?;
                    self.at += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b't' => out.push(b'\t'),
                        b'r' => out.push(b'\r'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'u' => {
                            let hex =
                                std::str::from_utf8(self.text.get(self.at..self.at + 4)?).ok()?;
                            self.at += 4;
                            let c = char::from_u32(u32::from_str_radix(hex, 16).ok()?)
                                .unwrap_or('\u{FFFD}');
                            out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                        }
                        other => out.push(other),
                    }
                }
                _ => out.push(c),
            }
        }
        Some(String::from_utf8_lossy(&out).into_owned())
    }
}

/// What `parseJSONText` makes of a JSON module that is not JSON: TypeScript's parser reports the errors and goes on.
#[derive(Debug, Clone, PartialEq)]
pub enum Expression {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Identifier(String),
    /// What stands where an expression is missing, and for a hole in an array.
    Missing,
    Array(Vec<Expression>),
    Object(Vec<Property>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum PropertyName {
    /// An identifier, a string, or a number in the spelling `String(n)` gives it.
    Name(String),
    Computed(Expression),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Property {
    pub name: PropertyName,
    /// `None`: `{ name }`
    pub initializer: Option<Expression>,
}

impl Expression {
    /// `parseJSONText`. `None` for text that takes more of the parser than literals, names, objects and arrays.
    pub fn parse(text: &[u8]) -> Option<Expression> {
        let mut p = TolerantParser {
            scanner: Parser {
                text,
                at: 0,
                depth: 0,
            },
            token: Token::EndOfFile,
            contexts: 0,
        };
        if text.starts_with(b"\xEF\xBB\xBF") {
            p.scanner.at = 3;
        }
        p.next_token()?;
        let mut expressions = Vec::new();
        while p.token != Token::EndOfFile {
            let is_literal = match p.token.clone() {
                Token::OpenBracket => {
                    expressions.push(p.parse_array_literal_expression()?);
                    continue;
                }
                Token::Word(word) => matches!(word.as_str(), "true" | "false" | "null"),
                Token::Minus => {
                    let is_number = p.look_ahead(|p| {
                        p.next_token()?;
                        if !matches!(p.token, Token::Number(_)) {
                            return Some(false);
                        }
                        p.next_token()?;
                        Some(p.token != Token::Colon)
                    })?;
                    if is_number {
                        expressions.push(p.parse_prefix_unary_expression()?);
                        continue;
                    }
                    false
                }
                Token::Number(_) | Token::String(_) => p.look_ahead(|p| {
                    p.next_token()?;
                    Some(p.token != Token::Colon)
                })?,
                _ => false,
            };
            expressions.push(if is_literal {
                p.parse_literal_expression()?
            } else {
                p.parse_object_literal_expression()?
            });
        }
        // Several expressions at the top are the elements of an array.
        if expressions.len() == 1 {
            expressions.pop()
        } else {
            Some(Expression::Array(expressions))
        }
    }
}

#[derive(Clone, PartialEq)]
enum Token {
    OpenBrace,
    CloseBrace,
    OpenBracket,
    CloseBracket,
    Comma,
    Colon,
    Semicolon,
    Minus,
    String(String),
    Number(f64),
    /// An identifier or a keyword.
    Word(String),
    EndOfFile,
}

/// `PCObjectLiteralMembers`, `PCArrayLiteralMembers`
const OBJECT_LITERAL_MEMBERS: u8 = 1;
const ARRAY_LITERAL_MEMBERS: u8 = 2;

/// `KindFirstReservedWord` to `KindLastReservedWord`
pub(crate) fn is_reserved_word(word: &str) -> bool {
    matches!(
        word,
        "break"
            | "case"
            | "catch"
            | "class"
            | "const"
            | "continue"
            | "debugger"
            | "default"
            | "delete"
            | "do"
            | "else"
            | "enum"
            | "export"
            | "extends"
            | "false"
            | "finally"
            | "for"
            | "function"
            | "if"
            | "import"
            | "in"
            | "instanceof"
            | "new"
            | "null"
            | "return"
            | "super"
            | "switch"
            | "this"
            | "throw"
            | "true"
            | "try"
            | "typeof"
            | "var"
            | "void"
            | "while"
            | "with"
    )
}

/// `IsModifierKind`, `get` and `set`
fn is_modifier_or_accessor_keyword(word: &str) -> bool {
    matches!(
        word,
        "abstract"
            | "accessor"
            | "async"
            | "const"
            | "declare"
            | "default"
            | "export"
            | "in"
            | "private"
            | "protected"
            | "public"
            | "readonly"
            | "out"
            | "override"
            | "static"
            | "get"
            | "set"
    )
}

/// The part of TypeScript's parser that JSON with errors in it takes. Every function is `None` for what it does not read.
struct TolerantParser<'a> {
    scanner: Parser<'a>,
    token: Token,
    /// `parsingContexts`
    contexts: u8,
}

impl TolerantParser<'_> {
    fn next_token(&mut self) -> Option<()> {
        self.scanner.skip();
        let start = self.scanner.at;
        let Some(c) = self.scanner.peek() else {
            self.token = Token::EndOfFile;
            return Some(());
        };
        self.token = match c {
            b'"' | b'\'' => Token::String(self.scan_string(c)?),
            b'0'..=b'9' => Token::Number(self.scan_number()?),
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => {
                while matches!(
                    self.scanner.peek(),
                    Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$')
                ) {
                    self.scanner.at += 1;
                }
                // The rest of a name that is not ASCII, or is written with an escape.
                if matches!(self.scanner.peek(), Some(b'\\' | 0x80..=0xFF)) {
                    return None;
                }
                let word = &self.scanner.text[start..self.scanner.at];
                Token::Word(String::from_utf8_lossy(word).into_owned())
            }
            _ => {
                self.scanner.at += 1;
                match c {
                    b'{' => Token::OpenBrace,
                    b'}' => Token::CloseBrace,
                    b'[' => Token::OpenBracket,
                    b']' => Token::CloseBracket,
                    b',' => Token::Comma,
                    b':' => Token::Colon,
                    b';' => Token::Semicolon,
                    b'-' if !matches!(self.scanner.peek(), Some(b'-' | b'=')) => Token::Minus,
                    _ => return None,
                }
            }
        };
        Some(())
    }

    /// `scanString`, of a string that ends on the line it starts on.
    fn scan_string(&mut self, quote: u8) -> Option<String> {
        let s = &mut self.scanner;
        s.at += 1;
        let mut out = Vec::new();
        loop {
            let c = s.peek()?;
            s.at += 1;
            match c {
                _ if c == quote => break,
                b'\n' | b'\r' => return None,
                b'\\' => {
                    let e = s.peek()?;
                    s.at += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b't' => out.push(b'\t'),
                        b'r' => out.push(b'\r'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'v' => out.push(11),
                        b'u' => {
                            let hex = std::str::from_utf8(s.text.get(s.at..s.at + 4)?).ok()?;
                            s.at += 4;
                            let c = char::from_u32(u32::from_str_radix(hex, 16).ok()?)
                                .unwrap_or('\u{FFFD}');
                            out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                        }
                        b'0'..=b'9' | b'x' | b'\n' | b'\r' => return None,
                        other => out.push(other),
                    }
                }
                _ => out.push(c),
            }
        }
        Some(String::from_utf8_lossy(&out).into_owned())
    }

    fn scan_digits(&mut self) -> bool {
        let start = self.scanner.at;
        while matches!(self.scanner.peek(), Some(b'0'..=b'9')) {
            self.scanner.at += 1;
        }
        self.scanner.at > start
    }

    /// `scanNumber`, of a decimal literal.
    fn scan_number(&mut self) -> Option<f64> {
        let start = self.scanner.at;
        self.scan_digits();
        if self.scanner.text[start] == b'0' && self.scanner.at - start > 1 {
            return None;
        }
        if self.scanner.peek() == Some(b'.') {
            self.scanner.at += 1;
            self.scan_digits();
        }
        if matches!(self.scanner.peek(), Some(b'e' | b'E')) {
            self.scanner.at += 1;
            if matches!(self.scanner.peek(), Some(b'+' | b'-')) {
                self.scanner.at += 1;
            }
            if !self.scan_digits() {
                return None;
            }
        }
        // `0x1`, `1n`, `1_000`, `1a`
        if matches!(
            self.scanner.peek(),
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'\\' | 0x80..=0xFF)
        ) {
            return None;
        }
        std::str::from_utf8(&self.scanner.text[start..self.scanner.at])
            .ok()?
            .parse()
            .ok()
    }

    /// `lookAhead`
    fn look_ahead<T>(&mut self, look: impl FnOnce(&mut Self) -> Option<T>) -> Option<T> {
        let (at, token) = (self.scanner.at, self.token.clone());
        let result = look(self);
        self.scanner.at = at;
        self.token = token;
        result
    }

    /// `isListElement`. `None` for a reserved word where an expression may start.
    fn is_list_element(&self, kind: u8) -> Option<bool> {
        if kind == OBJECT_LITERAL_MEMBERS {
            // A computed name, or `isLiteralPropertyName`.
            return Some(matches!(
                self.token,
                Token::OpenBracket | Token::Word(_) | Token::String(_) | Token::Number(_)
            ));
        }
        // A hole, or `isStartOfExpression`.
        match &self.token {
            Token::Word(word) if matches!(word.as_str(), "true" | "false" | "null") => Some(true),
            Token::Word(word) if is_reserved_word(word) => None,
            Token::Word(_)
            | Token::Comma
            | Token::OpenBrace
            | Token::OpenBracket
            | Token::Minus
            | Token::String(_)
            | Token::Number(_) => Some(true),
            _ => Some(false),
        }
    }

    /// `isListTerminator`
    fn is_list_terminator(&self, kind: u8) -> bool {
        self.token == Token::EndOfFile
            || self.token
                == if kind == OBJECT_LITERAL_MEMBERS {
                    Token::CloseBrace
                } else {
                    Token::CloseBracket
                }
    }

    /// `isInSomeParsingContext`
    fn is_in_some_parsing_context(&self) -> Option<bool> {
        for kind in [OBJECT_LITERAL_MEMBERS, ARRAY_LITERAL_MEMBERS] {
            if self.contexts & kind != 0
                && (self.is_list_element(kind)? || self.is_list_terminator(kind))
            {
                return Some(true);
            }
        }
        Some(false)
    }

    /// `parseDelimitedList`
    fn parse_delimited_list<T>(
        &mut self,
        kind: u8,
        parse_element: fn(&mut Self) -> Option<T>,
    ) -> Option<Vec<T>> {
        let saved = self.contexts;
        self.contexts |= kind;
        let mut list = Vec::new();
        loop {
            if self.is_list_element(kind)? {
                list.push(parse_element(self)?);
                if self.token == Token::Comma {
                    self.next_token()?;
                    continue;
                }
                if self.is_list_terminator(kind) {
                    break;
                }
                // The comma is missing. A semicolon in its place is skipped.
                if kind == OBJECT_LITERAL_MEMBERS && self.token == Token::Semicolon {
                    self.next_token()?;
                }
                continue;
            }
            if self.is_list_terminator(kind) {
                break;
            }
            // `abortParsingListOrMoveToNextToken`
            if self.is_in_some_parsing_context()? {
                break;
            }
            self.next_token()?;
        }
        self.contexts = saved;
        Some(list)
    }

    /// `parseLiteralExpression`, `parseTokenNode`
    fn parse_literal_expression(&mut self) -> Option<Expression> {
        let literal = match std::mem::replace(&mut self.token, Token::EndOfFile) {
            Token::String(text) => Expression::String(text),
            Token::Number(n) => Expression::Number(n),
            Token::Word(word) if word == "true" => Expression::Bool(true),
            Token::Word(word) if word == "false" => Expression::Bool(false),
            Token::Word(word) if word == "null" => Expression::Null,
            _ => return None,
        };
        self.next_token()?;
        Some(literal)
    }

    /// `parsePrefixUnaryExpression`, of `-` before a number.
    fn parse_prefix_unary_expression(&mut self) -> Option<Expression> {
        self.next_token()?;
        let Token::Number(n) = self.token else {
            return None;
        };
        self.next_token()?;
        // `parseMemberExpressionRest`
        if self.token == Token::OpenBracket {
            return None;
        }
        Some(Expression::Number(-n))
    }

    fn enter(&mut self) -> Option<()> {
        self.scanner.depth += 1;
        (self.scanner.depth <= 200).then_some(())
    }

    /// `parseArrayLiteralExpression`
    fn parse_array_literal_expression(&mut self) -> Option<Expression> {
        self.enter()?;
        if self.token == Token::OpenBracket {
            self.next_token()?;
        }
        let elements = self.parse_delimited_list(
            ARRAY_LITERAL_MEMBERS,
            Self::parse_argument_or_array_literal_element,
        )?;
        if self.token == Token::CloseBracket {
            self.next_token()?;
        }
        self.scanner.depth -= 1;
        Some(Expression::Array(elements))
    }

    /// `parseArgumentOrArrayLiteralElement`
    fn parse_argument_or_array_literal_element(&mut self) -> Option<Expression> {
        if self.token == Token::Comma {
            return Some(Expression::Missing);
        }
        self.parse_assignment_expression_or_higher()
    }

    /// `parseObjectLiteralExpression`. Without the `{` the members are read all the same.
    fn parse_object_literal_expression(&mut self) -> Option<Expression> {
        self.enter()?;
        if self.token == Token::OpenBrace {
            self.next_token()?;
        }
        let properties =
            self.parse_delimited_list(OBJECT_LITERAL_MEMBERS, Self::parse_object_literal_element)?;
        if self.token == Token::CloseBrace {
            self.next_token()?;
        }
        self.scanner.depth -= 1;
        Some(Expression::Object(properties))
    }

    /// `parseObjectLiteralElement`
    fn parse_object_literal_element(&mut self) -> Option<Property> {
        let mut token_is_identifier = false;
        // `parsePropertyName`
        let name = match std::mem::replace(&mut self.token, Token::EndOfFile) {
            Token::Word(word) => {
                self.next_token()?;
                // `nextTokenCanFollowModifier`: before anything else the word may be a modifier.
                let is_the_name = matches!(
                    self.token,
                    Token::Colon | Token::Comma | Token::CloseBrace | Token::EndOfFile
                );
                if !is_the_name && is_modifier_or_accessor_keyword(&word) {
                    return None;
                }
                // `isIdentifier`, which for these two depends on what is around.
                if matches!(word.as_str(), "await" | "yield") && self.token != Token::Colon {
                    return None;
                }
                token_is_identifier = !is_reserved_word(&word);
                PropertyName::Name(word)
            }
            Token::String(text) => {
                self.next_token()?;
                PropertyName::Name(text)
            }
            Token::Number(n) => {
                self.next_token()?;
                PropertyName::Name(crate::atom::number_to_string(n))
            }
            // `parseComputedPropertyName`
            Token::OpenBracket => {
                self.next_token()?;
                let expression = self.parse_assignment_expression_or_higher()?;
                if self.token != Token::CloseBracket {
                    return None;
                }
                self.next_token()?;
                PropertyName::Computed(expression)
            }
            _ => return None,
        };
        if token_is_identifier && self.token != Token::Colon {
            return Some(Property {
                name,
                initializer: None,
            });
        }
        if self.token == Token::Colon {
            self.next_token()?;
        }
        Some(Property {
            name,
            initializer: Some(self.parse_assignment_expression_or_higher()?),
        })
    }

    /// `parseAssignmentExpressionOrHigher`, of a literal, a name, an object, an array, or nothing at all.
    fn parse_assignment_expression_or_higher(&mut self) -> Option<Expression> {
        let expression = match self.token.clone() {
            Token::OpenBrace => self.parse_object_literal_expression()?,
            Token::OpenBracket => self.parse_array_literal_expression()?,
            Token::Minus => self.parse_prefix_unary_expression()?,
            Token::String(_) | Token::Number(_) => self.parse_literal_expression()?,
            Token::Word(word) => {
                if matches!(word.as_str(), "true" | "false" | "null") {
                    self.parse_literal_expression()?
                } else if is_reserved_word(&word)
                    || matches!(word.as_str(), "async" | "await" | "yield")
                {
                    return None;
                } else {
                    self.next_token()?;
                    Expression::Identifier(word)
                }
            }
            // `parseIdentifier(Expression_expected)`: no token is taken.
            _ => return Some(Expression::Missing),
        };
        // The expression goes on: an element access, an operator, an assertion.
        match &self.token {
            Token::OpenBracket | Token::Minus => None,
            Token::Word(word)
                if matches!(word.as_str(), "as" | "satisfies" | "in" | "instanceof") =>
            {
                None
            }
            _ => Some(expression),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_tsconfig() {
        let json =
            Json::parse(b"{ // c\n \"a\": [1, 2,], /* d */ \"b\": {\"c\": \"x\\ny\"}, }").unwrap();
        assert_eq!(json.get("a").unwrap().as_array().unwrap().len(), 2);
        assert_eq!(
            json.get("b").unwrap().get("c").unwrap().as_str(),
            Some("x\ny")
        );
    }

    #[test]
    fn recovers_from_syntax_errors() {
        let property = |name: &str, initializer: Option<Expression>| Property {
            name: PropertyName::Name(name.to_owned()),
            initializer,
        };
        assert_eq!(
            Expression::parse(b"a b"),
            Some(Expression::Object(vec![
                property("a", None),
                property("b", None)
            ]))
        );
        assert_eq!(
            Expression::parse(b"{'a': true} [1,, -2]"),
            Some(Expression::Array(vec![
                Expression::Object(vec![property("a", Some(Expression::Bool(true)))]),
                Expression::Array(vec![
                    Expression::Number(1.0),
                    Expression::Missing,
                    Expression::Number(-2.0)
                ]),
            ]))
        );
        assert_eq!(
            Expression::parse(b"{ [a]: }"),
            Some(Expression::Object(vec![Property {
                name: PropertyName::Computed(Expression::Identifier("a".to_owned())),
                initializer: Some(Expression::Missing),
            }]))
        );
        assert_eq!(Expression::parse(b"{ \"a\": 1 + 2 }"), None);
    }
}
