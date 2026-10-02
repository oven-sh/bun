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
pub struct Expression {
    pub kind: ExpressionKind,
    /// Where it starts. One that is missing: where the token that is no expression starts.
    pub pos: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ExpressionKind {
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
    pub name_pos: u32,
    /// `None`: `{ name }`
    pub initializer: Option<Expression>,
}

/// What `parseJSONText` objects to, from where to where.
#[derive(Debug, Clone, PartialEq)]
pub struct SyntaxError {
    pub start: u32,
    pub end: u32,
    pub code: u32,
    /// The token in `'{0}' expected.`
    pub expected: &'static str,
}

impl Expression {
    /// `parseJSONText`. `None` for text that takes more of the parser than literals, names, objects and arrays.
    pub fn parse(text: &[u8]) -> Option<Expression> {
        Some(Expression::parse_with_errors(text)?.0)
    }

    /// The same, with `SourceFile.Diagnostics()`.
    pub fn parse_with_errors(text: &[u8]) -> Option<(Expression, Vec<SyntaxError>)> {
        let mut p = TolerantParser {
            scanner: Parser {
                text,
                at: 0,
                depth: 0,
            },
            token: Token::EndOfFile,
            contexts: 0,
            token_start: 0,
            full_start: 0,
            errors: Vec::new(),
            invalid: Vec::new(),
            computed_names: 0,
        };
        if text.starts_with(b"\xEF\xBB\xBF") {
            p.scanner.at = 3;
        }
        p.next_token()?;
        let mut expressions = Vec::new();
        while p.token != Token::EndOfFile {
            // Nothing is expected after the first expression.
            if expressions.len() == 1 {
                p.error_at_token(1012, "");
            }
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
        let expression = if expressions.len() == 1 {
            expressions.pop()?
        } else {
            let start = expressions.first().map_or(0, |first| first.pos as usize);
            at(start, ExpressionKind::Array(expressions))
        };
        p.errors.append(&mut p.invalid);
        Some((expression, p.errors))
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

fn at(start: usize, kind: ExpressionKind) -> Expression {
    let pos = start as u32;
    Expression { kind, pos }
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
    /// `TokenStart`. The token ends where the scanner is.
    token_start: usize,
    /// `TokenFullStart`, `nodePos()`: where the token before ends.
    full_start: usize,
    /// `p.diagnostics`, as far as parsing goes.
    errors: Vec<SyntaxError>,
    /// What `validateJsonValue` adds in the end.
    invalid: Vec<SyntaxError>,
    /// How many computed names are being read. `validateJsonValue` does not look into them.
    computed_names: u32,
}

impl TolerantParser<'_> {
    /// `parseErrorAtRange`: an error where the last one is adds nothing.
    fn error_at(&mut self, start: usize, end: usize, code: u32, expected: &'static str) {
        let (start, end) = (start as u32, end as u32);
        if self.errors.last().is_none_or(|last| last.start != start) {
            self.errors.push(SyntaxError {
                start,
                end,
                code,
                expected,
            });
        }
    }

    /// `parseErrorAtCurrentToken`
    fn error_at_token(&mut self, code: u32, expected: &'static str) {
        self.error_at(self.token_start, self.scanner.at, code, expected);
    }

    /// `validateJsonValue`, `validateJsonObjectLiteral`: objects to the node that starts at `start` and ends with the last token taken.
    fn refuse(&mut self, start: usize, code: u32) {
        if self.computed_names == 0 {
            self.invalid.push(SyntaxError {
                start: start as u32,
                end: self.full_start.max(start) as u32,
                code,
                expected: "",
            });
        }
    }

    fn next_token(&mut self) -> Option<()> {
        self.full_start = self.scanner.at;
        self.scanner.skip();
        let start = self.scanner.at;
        self.token_start = start;
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
        let (token_start, full_start) = (self.token_start, self.full_start);
        let result = look(self);
        self.scanner.at = at;
        self.token = token;
        (self.token_start, self.full_start) = (token_start, full_start);
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
                self.error_at_token(1005, ",");
                if kind == OBJECT_LITERAL_MEMBERS && self.token == Token::Semicolon {
                    self.next_token()?;
                }
                continue;
            }
            if self.is_list_terminator(kind) {
                break;
            }
            // `abortParsingListOrMoveToNextToken`, `parsingContextErrors`
            let code = if kind == OBJECT_LITERAL_MEMBERS {
                1136
            } else {
                1137
            };
            self.error_at_token(code, "");
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
        let start = self.token_start;
        let is_single_quoted = self.scanner.text.get(start) == Some(&b'\'');
        let literal = match std::mem::replace(&mut self.token, Token::EndOfFile) {
            Token::String(text) => ExpressionKind::String(text),
            Token::Number(n) => ExpressionKind::Number(n),
            Token::Word(word) if word == "true" => ExpressionKind::Bool(true),
            Token::Word(word) if word == "false" => ExpressionKind::Bool(false),
            Token::Word(word) if word == "null" => ExpressionKind::Null,
            _ => return None,
        };
        self.next_token()?;
        // `isDoubleQuotedString`
        if is_single_quoted {
            self.refuse(start, 1327);
        }
        Some(at(start, literal))
    }

    /// `parsePrefixUnaryExpression`, of `-` before a number.
    fn parse_prefix_unary_expression(&mut self) -> Option<Expression> {
        let start = self.token_start;
        self.next_token()?;
        let Token::Number(n) = self.token else {
            return None;
        };
        self.next_token()?;
        // `parseMemberExpressionRest`
        if self.token == Token::OpenBracket {
            return None;
        }
        Some(at(start, ExpressionKind::Number(-n)))
    }

    fn enter(&mut self) -> Option<()> {
        self.scanner.depth += 1;
        (self.scanner.depth <= 200).then_some(())
    }

    /// `parseArrayLiteralExpression`
    fn parse_array_literal_expression(&mut self) -> Option<Expression> {
        let start = self.token_start;
        self.enter()?;
        if self.token == Token::OpenBracket {
            self.next_token()?;
        } else {
            self.error_at_token(1005, "[");
        }
        let elements = self.parse_delimited_list(
            ARRAY_LITERAL_MEMBERS,
            Self::parse_argument_or_array_literal_element,
        )?;
        if self.token == Token::CloseBracket {
            self.next_token()?;
        } else {
            self.error_at_token(1005, "]");
        }
        self.scanner.depth -= 1;
        Some(at(start, ExpressionKind::Array(elements)))
    }

    /// `parseArgumentOrArrayLiteralElement`
    fn parse_argument_or_array_literal_element(&mut self) -> Option<Expression> {
        if self.token == Token::Comma {
            self.refuse(self.token_start, 1328);
            return Some(at(self.token_start, ExpressionKind::Missing));
        }
        self.parse_assignment_expression_or_higher()
    }

    /// `parseObjectLiteralExpression`. Without the `{` the members are read all the same.
    fn parse_object_literal_expression(&mut self) -> Option<Expression> {
        let start = self.token_start;
        self.enter()?;
        if self.token == Token::OpenBrace {
            self.next_token()?;
        } else {
            self.error_at_token(1005, "{");
        }
        let properties =
            self.parse_delimited_list(OBJECT_LITERAL_MEMBERS, Self::parse_object_literal_element)?;
        if self.token == Token::CloseBrace {
            self.next_token()?;
        } else {
            self.error_at_token(1005, "}");
        }
        self.scanner.depth -= 1;
        Some(at(start, ExpressionKind::Object(properties)))
    }

    /// `parseObjectLiteralElement`
    fn parse_object_literal_element(&mut self) -> Option<Property> {
        let start = self.token_start;
        let is_double_quoted = self.scanner.text.get(start) == Some(&b'"');
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
                self.computed_names += 1;
                let expression = self.parse_assignment_expression_or_higher();
                self.computed_names -= 1;
                let expression = expression?;
                if self.token != Token::CloseBracket {
                    return None;
                }
                self.next_token()?;
                PropertyName::Computed(expression)
            }
            _ => return None,
        };
        if token_is_identifier && self.token != Token::Colon {
            // It is no `PropertyAssignment`.
            self.refuse(start, 1136);
            return Some(Property {
                name,
                name_pos: start as u32,
                initializer: None,
            });
        }
        if !is_double_quoted {
            self.refuse(start, 1327);
        }
        if self.token == Token::Colon {
            self.next_token()?;
        } else {
            self.error_at_token(1005, ":");
        }
        Some(Property {
            name,
            name_pos: start as u32,
            initializer: Some(self.parse_assignment_expression_or_higher()?),
        })
    }

    /// `parseAssignmentExpressionOrHigher`, of a literal, a name, an object, an array, or nothing at all.
    fn parse_assignment_expression_or_higher(&mut self) -> Option<Expression> {
        let start = self.token_start;
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
                    self.refuse(start, 1328);
                    at(start, ExpressionKind::Identifier(word))
                }
            }
            // `parseIdentifier(Expression_expected)`: no token is taken. `createIdentifierWithDiagnostic`: at the end of the file it is said
            // where the last token ends.
            _ => {
                if self.token == Token::EndOfFile {
                    self.error_at(self.full_start, self.full_start, 1109, "");
                } else {
                    self.error_at_token(1109, "");
                }
                self.refuse(start, 1328);
                return Some(at(start, ExpressionKind::Missing));
            }
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
