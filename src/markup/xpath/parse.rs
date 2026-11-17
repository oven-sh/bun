use super::{
    Axis, Expression, Function, Kind, NameTest, NodeKind, NodeTest, Operator, Start, Step,
    is_space, number_len, parse_number,
};
use crate::names::ncname_len;
use crate::{Chars, Text};

const MAX_DEPTH: usize = 200;

pub enum ParseError {
    Syntax,
    Namespace,
}

pub trait Names {
    type Name;
    fn intern(&mut self, name: Chars<'_>) -> Self::Name;
    fn resolve(&mut self, prefix: Chars<'_>) -> Option<Self::Name>;
}

#[derive(Clone, Copy, PartialEq)]
enum TokenKind {
    Name,
    Number,
    Literal,
    Operator,
    Symbol,
}

#[derive(Clone, Copy)]
struct Token<'a> {
    kind: TokenKind,
    text: Chars<'a>,
}

const OPERATORS: &[&str] = &["//", "!=", "<=", ">=", "/", "|", "+", "-", "=", "<", ">"];
const SYMBOLS: &[&str] = &["::", "..", "(", ")", "[", "]", ".", "@", ",", "$"];

/// `a`, `a:b` or `a:*`
fn name_len(text: Chars<'_>) -> usize {
    let first = ncname_len(text);
    if first == 0 || text.get(first) != Some(b':'.into()) {
        return first;
    }
    let rest = text.skip(first + 1);
    match ncname_len(rest) {
        0 if rest.starts_with(b"*") => first + 2,
        0 => first,
        second => first + 1 + second,
    }
}

fn tokenize(mut rest: Chars<'_>) -> Result<Vec<Token<'_>>, ParseError> {
    let mut tokens: Vec<Token<'_>> = Vec::new();
    loop {
        rest = rest.skip(rest.units().take_while(|it| is_space(*it)).count());
        let Some(first) = rest.get(0) else {
            return Ok(tokens);
        };
        let follows_operand = tokens.last().is_some_and(|last| match last.kind {
            TokenKind::Operator => false,
            TokenKind::Symbol => [")", "]", ".", ".."]
                .iter()
                .any(|it| last.text.is(it.as_bytes())),
            _ => true,
        });
        let word = if follows_operand {
            TokenKind::Operator
        } else {
            TokenKind::Name
        };
        let one_of = |list: &[&str]| {
            list.iter()
                .find(|it| rest.starts_with(it.as_bytes()))
                .map(|it| it.len())
        };
        if let quote @ (0x22 | 0x27) = first {
            let end = rest.find(1, quote as u8).ok_or(ParseError::Syntax)?;
            tokens.push(Token {
                kind: TokenKind::Literal,
                text: rest.slice(1..end),
            });
            rest = rest.skip(end + 1);
            continue;
        }
        let (kind, len) = match (number_len(rest), name_len(rest)) {
            (len @ 1.., _) => (TokenKind::Number, len),
            (_, len @ 1..) => (word, len),
            _ if first == b'*'.into() => (word, 1),
            _ => match one_of(OPERATORS) {
                Some(len) => (TokenKind::Operator, len),
                None => (
                    TokenKind::Symbol,
                    one_of(SYMBOLS).ok_or(ParseError::Syntax)?,
                ),
            },
        };
        tokens.push(Token {
            kind,
            text: rest.slice(0..len),
        });
        rest = rest.skip(len);
    }
}

const PRECEDENCE: &[&[(&str, Operator)]] = &[
    &[("or", Operator::Or)],
    &[("and", Operator::And)],
    &[("=", Operator::Equal), ("!=", Operator::NotEqual)],
    &[
        ("<", Operator::Less),
        ("<=", Operator::LessOrEqual),
        (">", Operator::Greater),
        (">=", Operator::GreaterOrEqual),
    ],
    &[("+", Operator::Add), ("-", Operator::Subtract)],
    &[
        ("*", Operator::Multiply),
        ("div", Operator::Divide),
        ("mod", Operator::Modulo),
    ],
];

const AXES: &[(&str, Axis)] = &[
    ("ancestor", Axis::Ancestor),
    ("ancestor-or-self", Axis::AncestorOrSelf),
    ("attribute", Axis::Attribute),
    ("child", Axis::Child),
    ("descendant", Axis::Descendant),
    ("descendant-or-self", Axis::DescendantOrSelf),
    ("following", Axis::Following),
    ("following-sibling", Axis::FollowingSibling),
    ("namespace", Axis::Namespace),
    ("parent", Axis::Parent),
    ("preceding", Axis::Preceding),
    ("preceding-sibling", Axis::PrecedingSibling),
    ("self", Axis::Itself),
];

/// With the least and the most arguments.
const FUNCTIONS: &[(&str, (Function, usize, usize))] = &[
    ("boolean", (Function::Boolean, 1, 1)),
    ("ceiling", (Function::Ceiling, 1, 1)),
    ("concat", (Function::Concat, 2, usize::MAX)),
    ("contains", (Function::Contains, 2, 2)),
    ("count", (Function::Count, 1, 1)),
    ("false", (Function::False, 0, 0)),
    ("floor", (Function::Floor, 1, 1)),
    ("id", (Function::Id, 1, 1)),
    ("lang", (Function::Lang, 1, 1)),
    ("last", (Function::Last, 0, 0)),
    ("local-name", (Function::LocalName, 0, 1)),
    ("name", (Function::Name, 0, 1)),
    ("namespace-uri", (Function::NamespaceUri, 0, 1)),
    ("normalize-space", (Function::NormalizeSpace, 0, 1)),
    ("not", (Function::Not, 1, 1)),
    ("number", (Function::Number, 0, 1)),
    ("position", (Function::Position, 0, 0)),
    ("round", (Function::Round, 1, 1)),
    ("starts-with", (Function::StartsWith, 2, 2)),
    ("string", (Function::String, 0, 1)),
    ("string-length", (Function::StringLength, 0, 1)),
    ("substring", (Function::Substring, 2, 3)),
    ("substring-after", (Function::SubstringAfter, 2, 2)),
    ("substring-before", (Function::SubstringBefore, 2, 2)),
    ("sum", (Function::Sum, 1, 1)),
    ("translate", (Function::Translate, 3, 3)),
    ("true", (Function::True, 0, 0)),
];

const KIND_TESTS: &[(&str, Option<NodeKind>)] = &[
    ("comment", Some(NodeKind::Comment)),
    ("node", None),
    ("processing-instruction", Some(NodeKind::Instruction)),
    ("text", Some(NodeKind::Text)),
];

fn look_up<T: Copy>(table: &[(&str, T)], name: Chars<'_>) -> Option<T> {
    table
        .iter()
        .find(|it| name.is(it.0.as_bytes()))
        .map(|it| it.1)
}

impl<N> Expression<N> {
    fn is_number(&self) -> bool {
        use Function::*;
        match &self.0 {
            Kind::Number(_) | Kind::Signed(..) => true,
            Kind::Chain(_, rest) => matches!(
                rest[0].0,
                Operator::Add
                    | Operator::Subtract
                    | Operator::Multiply
                    | Operator::Divide
                    | Operator::Modulo
            ),
            Kind::Call(function, _) => {
                matches!(
                    function,
                    Ceiling | Count | Floor | Last | Number | Position | Round | StringLength | Sum
                )
            }
            Kind::Path(Start::Filter(value, _), _) => value.is_number(),
            _ => false,
        }
    }

    fn reads_position(&self) -> bool {
        match &self.0 {
            Kind::Chain(first, rest) => {
                first.reads_position() || rest.iter().any(|it| it.1.reads_position())
            }
            Kind::Signed(value, _) | Kind::Path(Start::Filter(value, _), _) => {
                value.reads_position()
            }
            Kind::Call(Function::Last | Function::Position, _) => true,
            Kind::Union(all) | Kind::Call(_, all) => all.iter().any(Expression::reads_position),
            _ => false,
        }
    }
}

struct Parser<'a, R> {
    tokens: Vec<Token<'a>>,
    at: usize,
    depth: usize,
    names: &'a mut R,
}

type Parsed<T> = Result<T, ParseError>;

impl<'a, R: Names> Parser<'a, R> {
    fn is_at(&self, offset: usize, text: &str) -> bool {
        self.tokens
            .get(self.at + offset)
            .is_some_and(|it| it.kind != TokenKind::Literal && it.text.is(text.as_bytes()))
    }

    fn take(&mut self, text: &str) -> bool {
        let is_there = self.is_at(0, text);
        self.at += usize::from(is_there);
        is_there
    }

    fn expect(&mut self, text: &str) -> Parsed<()> {
        if self.take(text) {
            Ok(())
        } else {
            Err(ParseError::Syntax)
        }
    }

    fn next(&mut self) -> Parsed<Token<'a>> {
        self.at += 1;
        self.tokens
            .get(self.at - 1)
            .copied()
            .ok_or(ParseError::Syntax)
    }

    fn expression(&mut self) -> Parsed<Expression<R::Name>> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(ParseError::Syntax);
        }
        let parsed = self.chain(0);
        self.depth -= 1;
        parsed
    }

    /// The next token, with its precedence.
    fn operator(&self) -> Option<(usize, Operator)> {
        let token = self
            .tokens
            .get(self.at)
            .filter(|it| it.kind == TokenKind::Operator)?;
        PRECEDENCE
            .iter()
            .enumerate()
            .find_map(|(level, it)| Some((level, look_up(it, token.text)?)))
    }

    fn chain(&mut self, lowest: usize) -> Parsed<Expression<R::Name>> {
        let mut left = self.unary()?;
        while let Some((level, _)) = self.operator().filter(|it| it.0 >= lowest) {
            let mut rest = Vec::new();
            while let Some((_, operator)) = self.operator().filter(|it| it.0 == level) {
                self.at += 1;
                rest.push((operator, self.chain(level + 1)?));
            }
            left = Expression(Kind::Chain(Box::new(left), rest));
        }
        Ok(left)
    }

    fn unary(&mut self) -> Parsed<Expression<R::Name>> {
        let mut signs = 0;
        while self.take("-") {
            signs += 1;
        }
        let mut union = self.path()?;
        if self.is_at(0, "|") {
            let mut parts = vec![union];
            while self.take("|") {
                parts.push(self.path()?);
            }
            union = Expression(Kind::Union(parts));
        }
        Ok(if signs == 0 {
            union
        } else {
            Expression(Kind::Signed(Box::new(union), signs % 2 == 1))
        })
    }

    fn predicates(&mut self) -> Parsed<Vec<Expression<R::Name>>> {
        let mut all = Vec::new();
        while self.take("[") {
            all.push(self.expression()?);
            self.expect("]")?;
        }
        Ok(all)
    }

    fn name_test(&mut self, text: Chars<'_>) -> Parsed<NameTest<R::Name>> {
        if text.is(b"*") {
            return Ok(NameTest::Any);
        }
        if let Some(colon) = text.find(0, b':') {
            let namespace = self
                .names
                .resolve(text.slice(0..colon))
                .ok_or(ParseError::Namespace)?;
            let local = Some(text.skip(colon + 1))
                .filter(|it| !it.is(b"*"))
                .map(|it| self.names.intern(it));
            return Ok(NameTest::InNamespace { namespace, local });
        }
        let mut lowercase = Text::default();
        text.units().for_each(|it| {
            lowercase.push_unit(if (0x41..=0x5a).contains(&it) {
                it | 0x20
            } else {
                it
            })
        });
        Ok(NameTest::Unprefixed {
            local: self.names.intern(text),
            lowercase: self.names.intern(lowercase.chars()),
        })
    }

    fn step(&mut self) -> Parsed<Step<R::Name>> {
        for (abbreviation, axis) in [(".", Axis::Itself), ("..", Axis::Parent)] {
            if self.take(abbreviation) {
                return Ok(Step {
                    axis,
                    test: NodeTest::Any,
                    predicates: Vec::new(),
                });
            }
        }
        let mut axis = Axis::Child;
        if self.take("@") {
            axis = Axis::Attribute;
        } else if self.is_at(1, "::") {
            axis = look_up(AXES, self.next()?.text).ok_or(ParseError::Syntax)?;
            self.at += 1;
        }
        let token = self.next()?;
        if token.kind != TokenKind::Name {
            return Err(ParseError::Syntax);
        }
        let test = if self.take("(") {
            let kind = look_up(KIND_TESTS, token.text).ok_or(ParseError::Syntax)?;
            let has_target = self
                .tokens
                .get(self.at)
                .is_some_and(|it| it.kind == TokenKind::Literal);
            let test = match kind {
                Some(NodeKind::Instruction) if has_target => {
                    NodeTest::Instruction(self.next()?.text.into())
                }
                Some(kind) => NodeTest::Kind(kind),
                None => NodeTest::Any,
            };
            self.expect(")")?;
            test
        } else {
            NodeTest::Name(self.name_test(token.text)?)
        };
        Ok(Step {
            axis,
            test,
            predicates: self.predicates()?,
        })
    }

    fn primary(&mut self) -> Parsed<Expression<R::Name>> {
        let token = self.next()?;
        match token.kind {
            TokenKind::Literal => return Ok(Expression(Kind::Literal(token.text.into()))),
            TokenKind::Number => return Ok(Expression(Kind::Number(parse_number(token.text)))),
            _ if token.text.is(b"(") => {
                let inner = self.expression()?;
                self.expect(")")?;
                return Ok(inner);
            }
            _ => {}
        }
        let (function, least, most) = look_up(FUNCTIONS, token.text).ok_or(ParseError::Syntax)?;
        let mut arguments = Vec::new();
        self.expect("(")?;
        while !self.take(")") {
            if !arguments.is_empty() {
                self.expect(",")?;
            }
            arguments.push(self.expression()?);
        }
        if !(least..=most).contains(&arguments.len()) {
            return Err(ParseError::Syntax);
        }
        Ok(Expression(Kind::Call(function, arguments)))
    }

    /// The step that follows `//`.
    fn descend(&mut self, steps: &mut Vec<Step<R::Name>>) -> Parsed<()> {
        let mut step = self.step()?;
        if step.axis == Axis::Child
            && !step
                .predicates
                .iter()
                .any(|it| it.is_number() || it.reads_position())
        {
            step.axis = Axis::Descendant;
        } else {
            steps.push(Step {
                axis: Axis::DescendantOrSelf,
                test: NodeTest::Any,
                predicates: Vec::new(),
            });
        }
        steps.push(step);
        Ok(())
    }

    fn path(&mut self) -> Parsed<Expression<R::Name>> {
        let token = self
            .tokens
            .get(self.at)
            .copied()
            .ok_or(ParseError::Syntax)?;
        let continues = |it: &Self| it.is_at(0, "/") || it.is_at(0, "//");
        let is_call = token.kind == TokenKind::Name
            && self.is_at(1, "(")
            && look_up(KIND_TESTS, token.text).is_none();
        let mut steps = Vec::new();
        let start = if is_call
            || matches!(token.kind, TokenKind::Literal | TokenKind::Number)
            || self.is_at(0, "(")
        {
            let (value, predicates) = (self.primary()?, self.predicates()?);
            if predicates.is_empty() && !continues(self) {
                return Ok(value);
            }
            Start::Filter(Box::new(value), predicates)
        } else if continues(self) {
            let has_step = self
                .tokens
                .get(self.at + 1)
                .is_some_and(|it| it.kind == TokenKind::Name)
                || [".", "..", "@"].iter().any(|it| self.is_at(1, it));
            if !has_step && self.take("/") {
                return Ok(Expression(Kind::Path(Start::Root, steps)));
            }
            Start::Root
        } else {
            steps.push(self.step()?);
            Start::Context
        };
        loop {
            if self.take("//") {
                self.descend(&mut steps)?;
            } else if self.take("/") {
                steps.push(self.step()?);
            } else {
                return Ok(Expression(Kind::Path(start, steps)));
            }
        }
    }
}

pub fn parse<R: Names>(
    source: Chars<'_>,
    names: &mut R,
) -> Result<Expression<R::Name>, ParseError> {
    let mut parser = Parser {
        tokens: tokenize(source)?,
        at: 0,
        depth: 0,
        names,
    };
    let expression = parser.expression()?;
    if parser.at < parser.tokens.len() {
        Err(ParseError::Syntax)
    } else {
        Ok(expression)
    }
}
