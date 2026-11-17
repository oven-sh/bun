use core::ops::Range;
use std::sync::Arc;

use bun_collections::StringArrayHashMap;
use bun_core::strings;

use crate::Failed;
use crate::machine::{Text, Value, number_of_text};

const MAX_NESTING: u32 = 400;

pub(crate) type Symbol = u32;

#[derive(Default)]
pub(crate) struct Symbols(StringArrayHashMap<()>);

impl Symbols {
    pub(crate) fn of(&mut self, name: &[u8]) -> Symbol {
        bun_core::handle_oom(self.0.get_or_put(name)).index as Symbol
    }

    pub(crate) fn name(&self, symbol: Symbol) -> &[u8] {
        &self.0.keys()[symbol as usize]
    }

    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Operator {
    BitOr,
    BitXor,
    BitAnd,
    Equal,
    NotEqual,
    Same,
    NotSame,
    Less,
    Greater,
    LessOrEqual,
    GreaterOrEqual,
    In,
    InstanceOf,
    ShiftLeft,
    ShiftRight,
    ShiftRightUnsigned,
    Add,
    Subtract,
    Multiply,
    Divide,
    Remainder,
    Power,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Logical {
    Coalesce = 1,
    Or,
    And,
}

#[derive(Clone, Copy)]
pub(crate) enum Unary {
    Not,
    Minus,
    Plus,
    BitNot,
    TypeOf,
    Void,
    Delete,
}

#[derive(Clone, Copy)]
pub(crate) enum Defines {
    Value,
    Getter,
    Setter,
    Spread,
}

pub(crate) enum Suffix {
    Member(Expr),
    Call(Vec<Expr>),
    Optional,
}

/// What comes in a row is in a list: scripts have thousands of alternatives.
pub(crate) enum Expr {
    Value(Value),
    Pattern(Text, Text),
    Name(Symbol),
    This,
    Array(Vec<Expr>),
    Object(Vec<(Expr, Defines, Expr)>),
    Spread(Box<Expr>),
    Function(Arc<Function>),
    New(Box<Expr>, Vec<Expr>),
    Suffixed(Box<Expr>, Vec<Suffix>),
    Unary(Unary, Box<Expr>),
    Update {
        target: Box<Expr>,
        by: f64,
        gives_old: bool,
    },
    Binary(Box<Expr>, Vec<(Operator, Expr)>),
    Logical(Logical, Vec<Expr>),
    Conditional(Box<[Expr; 3]>),
    Assign(Box<[Expr; 2]>, Option<Operator>),
    Sequence(Vec<Expr>),
}

pub(crate) enum Loop {
    Counting {
        start: Option<Expr>,
        test: Option<Expr>,
        update: Option<Expr>,
        tests_first: bool,
    },
    Each {
        target: Expr,
        subject: Expr,
        wants_keys: bool,
    },
}

#[derive(Default)]
pub(crate) struct Block {
    pub(crate) variables: Vec<Symbol>,
    pub(crate) functions: Vec<(Symbol, Arc<Function>)>,
    /// Which can outlive it.
    pub(crate) has_closures: bool,
    pub(crate) body: Vec<Stmt>,
}

pub(crate) struct Try {
    pub(crate) body: Block,
    pub(crate) caught: Option<Symbol>,
    pub(crate) handler: Option<Block>,
    pub(crate) last: Option<Block>,
}

pub(crate) enum Stmt {
    Expr(Expr),
    Block(Block),
    If(Vec<(Expr, Stmt)>, Option<Box<Stmt>>),
    Loop {
        labels: Vec<Symbol>,
        how: Box<Loop>,
        body: Box<Stmt>,
        renews_scope: bool,
    },
    Switch(Expr, Vec<(Option<Expr>, Vec<Stmt>)>),
    Try(Box<Try>),
    Labeled(Symbol, Box<Stmt>),
    Break(Option<Symbol>),
    Continue(Option<Symbol>),
    Return(Option<Expr>),
    Throw(Expr),
}

#[derive(Default)]
pub(crate) struct Function {
    pub(crate) own_name: Option<Symbol>,
    pub(crate) is_arrow: bool,
    pub(crate) uses_arguments: bool,
    pub(crate) parameters: Vec<Expr>,
    pub(crate) code: Block,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Number,
    Name,
    String,
    Template,
    Pattern,
    Symbol,
    End,
}

#[derive(Clone, Copy)]
struct Token<'s> {
    kind: Kind,
    text: &'s [u8],
    is_after_newline: bool,
}

fn is_name_part(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | 0x80..)
}

fn count_while(text: &[u8], test: impl Fn(u8) -> bool) -> usize {
    text.iter().take_while(|it| test(**it)).count()
}

fn len_of_spaces(text: &[u8]) -> usize {
    let mut rest = text;
    loop {
        rest = match rest {
            [b'\t'..=b'\r' | b' ', after @ ..]
            | [0xef, 0xbb, 0xbf, after @ ..]
            | [0xc2, 0xa0, after @ ..] => after,
            [b'/', b'/', after @ ..] => {
                &after[strings::index_of_any(after, b"\r\n").unwrap_or(after.len())..]
            }
            [b'/', b'*', after @ ..] => {
                &after[strings::index_of(after, b"*/").map_or(after.len(), |it| it + 2)..]
            }
            _ => return text.len() - rest.len(),
        };
    }
}

fn len_of_number(text: &[u8]) -> usize {
    if let [b'0', b'x' | b'X' | b'b' | b'B' | b'o' | b'O', digits @ ..] = text {
        return 2 + count_while(digits, |it| it.is_ascii_hexdigit());
    }
    let digits = |from: usize| from + count_while(&text[from..], |it| it.is_ascii_digit());
    let mut end = digits(0);
    if text.get(end) == Some(&b'.') {
        end = digits(end + 1);
    }
    match text[end..] {
        [b'e' | b'E', b'0'..=b'9', ..] => digits(end + 1),
        [b'e' | b'E', b'-' | b'+', b'0'..=b'9', ..] => digits(end + 2),
        _ => end,
    }
}

/// Of a string, or of a pattern without its flags.
fn len_of_quoted(text: &[u8]) -> Option<usize> {
    let (mut at, mut is_in_class) = (1, false);
    loop {
        match *text.get(at)? {
            b'\n' => return None,
            b'\\' => at += 1 + usize::from(text[at..].starts_with(b"\\\r\n")),
            b'[' if text[0] == b'/' => is_in_class = true,
            b']' => is_in_class = false,
            byte if byte == text[0] && !is_in_class => return Some(at + 1),
            _ => {}
        }
        at += 1;
    }
}

/// `found` gets where the substitutions are.
fn len_of_template(text: &[u8], mut found: impl FnMut(Range<usize>)) -> Option<usize> {
    let (mut at, mut open, mut start) = (1, vec![text[0]], 0);
    while let Some(innermost) = open.last() {
        match (*innermost, &text[at..]) {
            (_, []) => return None,
            (b'`', [b'\\', _, ..]) => at += 1,
            (b'`', [b'$', b'{', ..]) => {
                at += 1;
                start = if open.len() == 1 { at + 1 } else { start };
                open.push(b'{');
            }
            (b'`', [b'`', ..]) | (b'{', [b'}', ..]) => {
                open.pop();
                if open.len() == 1 {
                    found(start..at);
                }
            }
            (b'{', [byte @ (b'{' | b'`'), ..]) => open.push(*byte),
            (b'{', [b'"' | b'\'', ..]) => at += len_of_quoted(&text[at..])? - 1,
            _ => {}
        }
        at += 1;
    }
    Some(at)
}

fn len_of_symbol(text: &[u8]) -> Option<usize> {
    const LONG: [&[u8]; 17] = [
        b">>>=", b">>>", b"===", b"!==", b"<<=", b">>=", b"**=", b"...", b"=>", b"<<", b">>",
        b"&&", b"||", b"??", b"++", b"--", b"**",
    ];
    if let [b'?', b'.', after, ..] = text
        && !after.is_ascii_digit()
    {
        return Some(2);
    }
    LONG.iter()
        .find(|it| text.starts_with(it))
        .map(|it| it.len())
        .or_else(|| match text[0] {
            b'-' | b'+' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'<' | b'>' | b'=' | b'!' => {
                Some(1 + usize::from(text.get(1) == Some(&b'=')))
            }
            b'(' | b')' | b'{' | b'}' | b'[' | b']' | b';' | b',' | b'.' | b'?' | b':' | b'~' => {
                Some(1)
            }
            _ => None,
        })
}

fn tokenize(mut source: &[u8]) -> Result<Vec<Token<'_>>, Failed> {
    let mut tokens = Vec::<Token<'_>>::new();
    loop {
        let (spaces, rest) = source.split_at(len_of_spaces(source));
        let follows_value = tokens.last().is_some_and(|it| match it.kind {
            Kind::Symbol => matches!(it.text, b")" | b"]" | b"}"),
            Kind::Name => !matches!(
                it.text,
                b"return" | b"typeof" | b"case" | b"in" | b"of" | b"else" | b"void"
            ),
            _ => true,
        });
        let (kind, len) = match rest {
            [] => {
                tokens.push(Token {
                    kind: Kind::End,
                    text: b"",
                    is_after_newline: true,
                });
                return Ok(tokens);
            }
            [b'0'..=b'9', ..] | [b'.', b'0'..=b'9', ..] => (Kind::Number, len_of_number(rest)),
            [b'"' | b'\'', ..] => (Kind::String, len_of_quoted(rest).ok_or(Failed)?),
            [b'`', ..] => (Kind::Template, len_of_template(rest, |_| {}).ok_or(Failed)?),
            [b'/', ..] if !follows_value => {
                let len = len_of_quoted(rest).ok_or(Failed)?;
                (
                    Kind::Pattern,
                    len + count_while(&rest[len..], |it| it.is_ascii_lowercase()),
                )
            }
            [first, ..] if is_name_part(*first) => (Kind::Name, count_while(rest, is_name_part)),
            _ => (Kind::Symbol, len_of_symbol(rest).ok_or(Failed)?),
        };
        tokens.push(Token {
            kind,
            text: &rest[..len],
            is_after_newline: strings::contains_char(spaces, b'\n'),
        });
        source = &rest[len..];
    }
}

/// What Latin-1 does not have is in UTF-8.
pub(crate) fn push_unit(out: &mut Vec<u8>, unit: u32) {
    match u8::try_from(unit) {
        Ok(byte) => out.push(byte),
        Err(_) => out.extend_from_slice(
            char::from_u32(unit)
                .unwrap_or(char::REPLACEMENT_CHARACTER)
                .encode_utf8(&mut [0; 4])
                .as_bytes(),
        ),
    }
}

fn unescape(mut rest: &[u8]) -> Expr {
    let mut out = Vec::new();
    while let Some((before, after)) = strings::split_once_char(rest, b'\\') {
        out.extend_from_slice(before);
        let hex = |len: usize| bun_core::fmt::parse_unsigned::<u32>(after.get(1..=len)?, 16).ok();
        let skipped = match after {
            [b'x', ..] if let Some(unit) = hex(2) => {
                push_unit(&mut out, unit);
                3
            }
            [b'u', ..] if let Some(unit) = hex(4) => {
                push_unit(&mut out, unit);
                5
            }
            [b'\r', b'\n', ..] => 2,
            [b'\n', ..] => 1,
            [byte, ..] => {
                out.push(
                    strings::index_of_char_usize(b"nrtbfv0", *byte)
                        .map_or(*byte, |it| b"\n\r\t\x08\x0c\x0b\0"[it]),
                );
                1
            }
            [] => 0,
        };
        rest = &after[skipped..];
    }
    out.extend_from_slice(rest);
    Expr::Value(out[..].into())
}

fn operator_of(text: &[u8]) -> Option<(u8, Operator)> {
    use Operator::*;
    Some(match text {
        b"|" => (4, BitOr),
        b"^" => (5, BitXor),
        b"&" => (6, BitAnd),
        b"==" => (7, Equal),
        b"!=" => (7, NotEqual),
        b"===" => (7, Same),
        b"!==" => (7, NotSame),
        b"<" => (8, Less),
        b">" => (8, Greater),
        b"<=" => (8, LessOrEqual),
        b">=" => (8, GreaterOrEqual),
        b"in" => (8, In),
        b"instanceof" => (8, InstanceOf),
        b"<<" => (9, ShiftLeft),
        b">>" => (9, ShiftRight),
        b">>>" => (9, ShiftRightUnsigned),
        b"+" => (10, Add),
        b"-" => (10, Subtract),
        b"*" => (11, Multiply),
        b"/" => (11, Divide),
        b"%" => (11, Remainder),
        b"**" => (12, Power),
        _ => return None,
    })
}

struct Parser<'s, 'n> {
    tokens: Vec<Token<'s>>,
    at: usize,
    nesting: u32,
    allows_in: bool,
    symbols: &'n mut Symbols,
    /// The one that is being parsed.
    function: Function,
    /// The one that is being parsed, unless that is the body of the function.
    block: Option<Block>,
}

type Parsed<T> = Result<T, Failed>;

pub(crate) fn parse(source: &[u8], symbols: &mut Symbols) -> Parsed<Block> {
    let mut parser = Parser {
        tokens: tokenize(source)?,
        at: 0,
        nesting: 0,
        allows_in: true,
        symbols,
        function: Function::default(),
        block: None,
    };
    parser.function.code.body = parser.statements(|it| it.peek(0).kind == Kind::End)?;
    Ok(parser.function.code)
}

fn declare(pattern: &Expr, names: &mut Vec<Symbol>) -> Parsed<()> {
    match pattern {
        Expr::Name(name) => {
            names.push(*name);
            Ok(())
        }
        Expr::Value(Value::Undefined) => Ok(()),
        Expr::Spread(rest) => declare(rest, names),
        Expr::Assign(parts, None) => declare(&parts[0], names),
        Expr::Array(items) => items.iter().try_for_each(|it| declare(it, names)),
        Expr::Object(properties) => properties.iter().try_for_each(|it| declare(&it.2, names)),
        _ => Err(Failed),
    }
}

fn target(expr: Expr) -> Parsed<Expr> {
    match &expr {
        Expr::Name(_) | Expr::Array(_) | Expr::Object(_) => Ok(expr),
        Expr::Suffixed(_, suffixes) if matches!(suffixes.last(), Some(Suffix::Member(_))) => {
            Ok(expr)
        }
        _ => Err(Failed),
    }
}

impl<'s> Parser<'s, '_> {
    fn peek(&self, ahead: usize) -> Token<'s> {
        self.tokens[(self.at + ahead).min(self.tokens.len() - 1)]
    }

    fn next(&mut self) -> Token<'s> {
        let token = self.peek(0);
        self.at += 1;
        token
    }

    fn is_ahead(&self, text: &str, ahead: usize) -> bool {
        let token = self.peek(ahead);
        token.text == text.as_bytes() && matches!(token.kind, Kind::Symbol | Kind::Name)
    }

    fn is(&self, text: &str) -> bool {
        self.is_ahead(text, 0)
    }

    fn eat(&mut self, text: &str) -> bool {
        let is_there = self.is(text);
        self.at += usize::from(is_there);
        is_there
    }

    fn expect(&mut self, text: &str) -> Parsed<()> {
        self.eat(text).then_some(()).ok_or(Failed)
    }

    fn name(&mut self) -> Parsed<Symbol> {
        let token = self.next();
        (token.kind == Kind::Name)
            .then(|| self.symbols.of(token.text))
            .ok_or(Failed)
    }

    fn list<T>(&mut self, end: &str, item: fn(&mut Self) -> Parsed<T>) -> Parsed<Vec<T>> {
        self.nested(true, |it| {
            let mut items = Vec::new();
            while !it.eat(end) {
                items.push(item(it)?);
                if !it.is(end) {
                    it.expect(",")?;
                }
            }
            Ok(items)
        })
    }

    fn nested<T>(
        &mut self,
        allows_in: bool,
        parse: impl FnOnce(&mut Self) -> Parsed<T>,
    ) -> Parsed<T> {
        if self.nesting == MAX_NESTING || !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Err(Failed);
        }
        self.nesting += 1;
        let before = core::mem::replace(&mut self.allows_in, allows_in);
        let result = parse(self);
        self.allows_in = before;
        self.nesting -= 1;
        result
    }

    fn closure(
        &mut self,
        parameters: Vec<Expr>,
        is_arrow: bool,
        own_name: Option<Symbol>,
    ) -> Parsed<Arc<Function>> {
        let mut code = Block {
            has_closures: !parameters.iter().all(|it| matches!(it, Expr::Name(_))),
            ..Default::default()
        };
        parameters
            .iter()
            .try_for_each(|it| declare(it, &mut code.variables))?;
        let outer = (
            core::mem::replace(
                &mut self.function,
                Function {
                    own_name,
                    is_arrow,
                    uses_arguments: false,
                    parameters,
                    code,
                },
            ),
            self.block.take(),
        );
        self.function.code.body = match self.is("{") || !is_arrow {
            true => self
                .expect("{")
                .and_then(|()| self.statements(|it| it.eat("}")))?,
            false => vec![Stmt::Return(Some(self.nested(true, Self::assignment)?))],
        };
        let parsed = core::mem::replace(&mut self.function, outer.0);
        self.block = outer.1.map(|it| Block {
            has_closures: true,
            ..it
        });
        self.function.code.has_closures = true;
        self.function.uses_arguments |= is_arrow && parsed.uses_arguments;
        Ok(Arc::new(parsed))
    }

    fn method(&mut self, own_name: Option<Symbol>) -> Parsed<Arc<Function>> {
        self.expect("(")?;
        let parameters = self.list(")", Self::item)?;
        self.closure(parameters, false, own_name)
    }

    fn item(&mut self) -> Parsed<Expr> {
        match () {
            () if self.is(",") => Ok(Expr::Value(Value::Undefined)),
            () if self.eat("...") => Ok(Expr::Spread(self.assignment()?.into())),
            () => self.assignment(),
        }
    }

    fn template(&mut self, text: &'s [u8]) -> Parsed<Expr> {
        let (mut substitutions, mut parts, mut start) = (Vec::new(), Vec::new(), 1);
        len_of_template(text, |it| substitutions.push(it));
        for range in substitutions {
            parts.push((Operator::Add, unescape(&text[start..range.start - 2])));
            start = range.end + 1;
            let outer = (
                core::mem::replace(&mut self.tokens, tokenize(&text[range])?),
                core::mem::take(&mut self.at),
            );
            parts.push((Operator::Add, self.nested(true, Self::expression)?));
            (self.peek(0).kind == Kind::End)
                .then_some(())
                .ok_or(Failed)?;
            (self.tokens, self.at) = outer;
        }
        parts.push((Operator::Add, unescape(&text[start..text.len() - 1])));
        Ok(Expr::Binary(unescape(b"").into(), parts))
    }

    fn property(&mut self) -> Parsed<(Expr, Defines, Expr)> {
        if self.eat("...") {
            return Ok((
                Expr::Value(Value::Undefined),
                Defines::Spread,
                self.assignment()?,
            ));
        }
        let is_accessor = ![":", ",", "(", "}", "="]
            .iter()
            .any(|it| self.is_ahead(it, 1));
        let defines = match () {
            () if is_accessor && self.eat("get") => Defines::Getter,
            () if is_accessor && self.eat("set") => Defines::Setter,
            () => Defines::Value,
        };
        let token = self.next();
        let key = match token.kind {
            Kind::Name => Expr::Value(token.text.into()),
            Kind::String => unescape(&token.text[1..token.text.len() - 1]),
            Kind::Number => Expr::Value(number_of_text(token.text).into()),
            _ if token.text == b"[" => (self.assignment()?, self.expect("]")?).0,
            _ => return Err(Failed),
        };
        let value = match () {
            () if self.is("(") => Expr::Function(self.method(None)?),
            () if self.eat(":") => self.assignment()?,
            () if self.eat("=") => Expr::Assign(
                [Expr::Name(self.symbols.of(token.text)), self.assignment()?].into(),
                None,
            ),
            () => Expr::Name(self.symbols.of(token.text)),
        };
        Ok((key, defines, value))
    }

    fn primary(&mut self) -> Parsed<Expr> {
        let Token { kind, text, .. } = self.next();
        Ok(match (kind, text) {
            (Kind::Number, _) => Expr::Value(Value::Number(number_of_text(text))),
            (Kind::String, _) => unescape(&text[1..text.len() - 1]),
            (Kind::Template, _) => self.template(text)?,
            (Kind::Pattern, _) => {
                let (source, flags) = strings::rsplit_once_char(&text[1..], b'/').ok_or(Failed)?;
                Expr::Pattern(source.into(), flags.into())
            }
            (Kind::Name, b"function") => {
                let own_name = if self.is("(") {
                    None
                } else {
                    Some(self.name()?)
                };
                Expr::Function(self.method(own_name)?)
            }
            (Kind::Name, b"this") => Expr::This,
            (Kind::Name, b"null") => Expr::Value(Value::Null),
            (Kind::Name, b"true" | b"false") => Expr::Value(Value::Bool(text == b"true")),
            (Kind::Name, b"new") => {
                let callee = self.nested(true, |it| it.suffixed(false))?;
                Expr::New(
                    callee.into(),
                    if self.eat("(") {
                        self.list(")", Self::item)?
                    } else {
                        Vec::new()
                    },
                )
            }
            (Kind::Name, _) => {
                let name = self.symbols.of(text);
                self.function.uses_arguments |= text == b"arguments";
                if self.eat("=>") {
                    Expr::Function(self.closure(vec![Expr::Name(name)], true, None)?)
                } else {
                    Expr::Name(name)
                }
            }
            (Kind::Symbol, b"(") => {
                let mut items = self.list(")", Self::item)?;
                match items.len() {
                    _ if self.eat("=>") => Expr::Function(self.closure(items, true, None)?),
                    1 => items.remove(0),
                    _ => Expr::Sequence(items),
                }
            }
            (Kind::Symbol, b"[") => Expr::Array(self.list("]", Self::item)?),
            (Kind::Symbol, b"{") => Expr::Object(self.list("}", Self::property)?),
            _ => return Err(Failed),
        })
    }

    fn suffixed(&mut self, takes_calls: bool) -> Parsed<Expr> {
        let (base, mut suffixes) = (self.primary()?, Vec::new());
        loop {
            let is_optional = self.eat("?.");
            suffixes.extend(is_optional.then_some(Suffix::Optional));
            suffixes.push(
                if self.eat(".") || is_optional && self.peek(0).kind == Kind::Name {
                    let token = self.next();
                    (token.kind == Kind::Name).then_some(()).ok_or(Failed)?;
                    Suffix::Member(Expr::Value(Value::String(token.text.into())))
                } else if self.eat("[") {
                    let key = self.nested(true, Self::expression)?;
                    self.expect("]")?;
                    Suffix::Member(key)
                } else if takes_calls && self.eat("(") {
                    Suffix::Call(self.list(")", Self::item)?)
                } else if suffixes.is_empty() {
                    return Ok(base);
                } else {
                    return Ok(Expr::Suffixed(base.into(), suffixes));
                },
            );
        }
    }

    fn step(&mut self) -> Option<f64> {
        [("++", 1.0), ("--", -1.0)]
            .into_iter()
            .find(|it| self.eat(it.0))
            .map(|it| it.1)
    }

    fn unary(&mut self) -> Parsed<Expr> {
        use Unary::*;
        if let Some(by) = self.step() {
            let operand = self.nested(self.allows_in, Self::unary)?;
            return Ok(Expr::Update {
                target: target(operand)?.into(),
                by,
                gives_old: false,
            });
        }
        let operators = [
            ("!", Not),
            ("-", Minus),
            ("+", Plus),
            ("~", BitNot),
            ("typeof", TypeOf),
            ("void", Void),
            ("delete", Delete),
        ];
        if let Some((_, operator)) = operators.into_iter().find(|it| self.eat(it.0)) {
            return Ok(Expr::Unary(
                operator,
                self.nested(self.allows_in, Self::unary)?.into(),
            ));
        }
        let operand = self.suffixed(true)?;
        match if self.peek(0).is_after_newline {
            None
        } else {
            self.step()
        } {
            Some(by) => Ok(Expr::Update {
                target: target(operand)?.into(),
                by,
                gives_old: true,
            }),
            None => Ok(operand),
        }
    }

    fn operands(&mut self, above: u8) -> Parsed<Expr> {
        let (mut left, mut rest) = (self.unary()?, Vec::new());
        loop {
            let Token { kind, text, .. } = self.peek(0);
            let is_operator =
                kind == Kind::Symbol || kind == Kind::Name && (self.allows_in || text != b"in");
            match operator_of(text).filter(|it| is_operator && it.0 > above) {
                Some((precedence, operator)) => {
                    self.at += 1;
                    let groups_from_the_right = operator == Operator::Power;
                    rest.push((
                        operator,
                        self.nested(self.allows_in, |it| {
                            it.operands(precedence - u8::from(groups_from_the_right))
                        })?,
                    ));
                }
                None => break,
            }
        }
        if !rest.is_empty() {
            left = Expr::Binary(left.into(), rest);
        }
        for (text, logical) in [
            ("&&", Logical::And),
            ("||", Logical::Or),
            ("??", Logical::Coalesce),
        ] {
            if logical as u8 > above && self.is(text) {
                let mut all = vec![left];
                while self.eat(text) {
                    all.push(self.operands(logical as u8)?);
                }
                left = Expr::Logical(logical, all);
            }
        }
        Ok(left)
    }

    fn assignment(&mut self) -> Parsed<Expr> {
        let left = self.operands(0)?;
        if self.eat("?") {
            let yes = self.nested(true, Self::assignment)?;
            self.expect(":")?;
            return Ok(Expr::Conditional(
                [left, yes, self.nested(self.allows_in, Self::assignment)?].into(),
            ));
        }
        let Token { kind, text, .. } = self.peek(0);
        let Some(operator) = text.strip_suffix(b"=").filter(|_| kind == Kind::Symbol) else {
            return Ok(left);
        };
        self.at += 1;
        let right = self.nested(self.allows_in, Self::assignment)?;
        Ok(Expr::Assign(
            [target(left)?, right].into(),
            operator_of(operator).map(|it| it.1),
        ))
    }

    fn expression(&mut self) -> Parsed<Expr> {
        let first = self.assignment()?;
        if !self.is(",") {
            return Ok(first);
        }
        let mut all = vec![first];
        while self.eat(",") {
            all.push(self.assignment()?);
        }
        Ok(Expr::Sequence(all))
    }

    fn declarations(&mut self) -> Parsed<Expr> {
        let (is_for_block, mut all) = (self.next().text != b"var", Vec::new());
        loop {
            let pattern = self.primary()?;
            declare(
                &pattern,
                &mut self
                    .block
                    .as_mut()
                    .filter(|_| is_for_block)
                    .unwrap_or(&mut self.function.code)
                    .variables,
            )?;
            if self.eat("=") {
                all.push(Expr::Assign([pattern, self.assignment()?].into(), None));
            } else if self.is("in") || self.is("of") {
                return Ok(pattern);
            }
            if !self.eat(",") {
                return Ok(Expr::Sequence(all));
            }
        }
    }

    fn statements(&mut self, ends: fn(&mut Self) -> bool) -> Parsed<Vec<Stmt>> {
        let mut all = Vec::new();
        while !ends(self) {
            all.push(self.statement(Vec::new())?);
        }
        Ok(all)
    }

    fn scoped(&mut self, parse: impl FnOnce(&mut Self) -> Parsed<Vec<Stmt>>) -> Parsed<Block> {
        let outer = self.block.replace(Block::default());
        let body = parse(self)?;
        Ok(self.leave(outer, body))
    }

    fn leave(&mut self, outer: Option<Block>, body: Vec<Stmt>) -> Block {
        let inner = core::mem::replace(&mut self.block, outer).unwrap_or_default();
        self.block
            .iter_mut()
            .for_each(|it| it.has_closures |= inner.has_closures);
        Block { body, ..inner }
    }

    fn block(&mut self) -> Parsed<Block> {
        self.expect("{")?;
        self.scoped(|it| it.statements(|it| it.eat("}")))
    }

    fn condition(&mut self) -> Parsed<Expr> {
        self.expect("(")?;
        let test = self.expression()?;
        self.expect(")")?;
        Ok(test)
    }

    fn optional(&mut self, end: &str) -> Parsed<Option<Expr>> {
        let found = if self.is(end) {
            None
        } else {
            Some(self.expression()?)
        };
        self.expect(end)?;
        Ok(found)
    }

    fn head_of_for(&mut self) -> Parsed<Loop> {
        self.expect("(")?;
        let parse = if self.is("var") || self.is("let") || self.is("const") {
            Self::declarations
        } else {
            Self::expression
        };
        let start = if self.is(";") {
            None
        } else {
            Some(self.nested(false, parse)?)
        };
        if self.is("in") || self.is("of") {
            let wants_keys = self.next().text == b"in";
            let subject = self.optional(")")?.ok_or(Failed)?;
            return Ok(Loop::Each {
                target: target(start.ok_or(Failed)?)?,
                subject,
                wants_keys,
            });
        }
        self.expect(";")?;
        Ok(Loop::Counting {
            start,
            test: self.optional(";")?,
            update: self.optional(")")?,
            tests_first: true,
        })
    }

    fn switch(&mut self) -> Parsed<Stmt> {
        let (subject, mut cases) = (self.condition()?, Vec::new());
        self.expect("{")?;
        while !self.eat("}") {
            let test = if self.eat("default") {
                None
            } else {
                Some(self.expect("case").and_then(|()| self.expression())?)
            };
            self.expect(":")?;
            cases.push((
                test,
                self.statements(|it| it.is("case") || it.is("default") || it.is("}"))?,
            ));
        }
        Ok(Stmt::Switch(subject, cases))
    }

    fn attempt(&mut self) -> Parsed<Stmt> {
        let (body, handles, mut caught) = (self.block()?, self.eat("catch"), None);
        if handles && self.eat("(") {
            caught = Some(self.name()?);
            self.function.code.variables.extend(caught);
            self.expect(")")?;
        }
        let handler = if handles { Some(self.block()?) } else { None };
        Ok(Stmt::Try(
            Try {
                body,
                caught,
                handler,
                last: if self.eat("finally") {
                    Some(self.block()?)
                } else {
                    None
                },
            }
            .into(),
        ))
    }

    fn branches(&mut self) -> Parsed<Stmt> {
        let mut branches = Vec::new();
        loop {
            branches.push((self.condition()?, self.statement(Vec::new())?));
            if !self.eat("else") {
                return Ok(Stmt::If(branches, None));
            }
            if !self.eat("if") {
                return Ok(Stmt::If(branches, Some(self.statement(Vec::new())?.into())));
            }
        }
    }

    fn statement(&mut self, labels: Vec<Symbol>) -> Parsed<Stmt> {
        self.nested(true, |it| it.statement_here(labels))
    }

    fn statement_here(&mut self, mut labels: Vec<Symbol>) -> Parsed<Stmt> {
        let Token { kind, text, .. } = self.peek(0);
        if kind == Kind::Name && self.is_ahead(":", 1) {
            let label = self.name()?;
            self.at += 1;
            labels.push(label);
            return Ok(Stmt::Labeled(label, self.statement(labels)?.into()));
        }
        let keyword = if matches!(kind, Kind::Name | Kind::Symbol) {
            text
        } else {
            b""
        };
        self.at += 1;
        let next = self.peek(0);
        let is_bare = next.is_after_newline || self.is(";") || self.is("}");
        let statement = match keyword {
            b"{" => {
                return self
                    .scoped(|it| it.statements(|it| it.eat("}")))
                    .map(Stmt::Block);
            }
            b";" => return Ok(Stmt::Block(Block::default())),
            b"function" => {
                let entry = (self.name()?, self.method(None)?);
                self.function.code.variables.push(entry.0);
                self.block
                    .as_mut()
                    .unwrap_or(&mut self.function.code)
                    .functions
                    .push(entry);
                return Ok(Stmt::Block(Block::default()));
            }
            b"if" => return self.branches(),
            b"switch" => return self.scoped(|it| Ok(vec![it.switch()?])).map(Stmt::Block),
            b"try" => return self.attempt(),
            b"for" => {
                let parse = |it: &mut Self| {
                    let (how, body) = (it.head_of_for()?.into(), it.statement(Vec::new())?.into());
                    Ok(vec![Stmt::Loop {
                        labels,
                        how,
                        body,
                        renews_scope: it
                            .block
                            .as_ref()
                            .is_some_and(|it| it.has_closures && !it.variables.is_empty()),
                    }])
                };
                return self.scoped(parse).map(Stmt::Block);
            }
            b"while" => {
                let how = Loop::Counting {
                    start: None,
                    test: Some(self.condition()?),
                    update: None,
                    tests_first: true,
                };
                return Ok(Stmt::Loop {
                    labels,
                    how: how.into(),
                    body: self.statement(Vec::new())?.into(),
                    renews_scope: false,
                });
            }
            b"do" => {
                let body = self.statement(Vec::new())?.into();
                self.expect("while")?;
                let how = Loop::Counting {
                    start: None,
                    test: Some(self.condition()?),
                    update: None,
                    tests_first: false,
                };
                return Ok(Stmt::Loop {
                    labels,
                    how: how.into(),
                    body,
                    renews_scope: false,
                });
            }
            b"break" => Stmt::Break(if is_bare { None } else { Some(self.name()?) }),
            b"continue" => Stmt::Continue(if is_bare { None } else { Some(self.name()?) }),
            b"return" => Stmt::Return(if is_bare {
                None
            } else {
                Some(self.expression()?)
            }),
            b"throw" => Stmt::Throw(self.expression()?),
            _ => {
                self.at -= 1;
                Stmt::Expr(if matches!(keyword, b"var" | b"let" | b"const") {
                    self.declarations()?
                } else {
                    self.expression()?
                })
            }
        };
        match self.eat(";") || self.is("}") || self.peek(0).is_after_newline {
            true => Ok(statement),
            false => Err(Failed),
        }
    }
}
