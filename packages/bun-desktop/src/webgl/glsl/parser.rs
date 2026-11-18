//! From tokens to a tree: scopes and statements.

use std::collections::HashMap;

use super::builtins::{self, VARIABLES};
use super::lexer::{Kind, Known, Name, Names, Token};
use super::preprocessor::Output;
use super::tree::*;
use super::{DRAW_BUFFERS, Error, Extensions, Limits, MAX_DEPTH, Options, Result, Stage};

/// Expressions in `main` once the driver has inlined all calls.
const MAX_INLINED: u32 = 1 << 19;
const MAX_INLINED_NESTING: usize = 1 << 10;
const MAX_FUNCTIONS: usize = 1 << 10;
const MAX_LABELS: usize = 1 << 11;

#[derive(Clone, Copy)]
pub enum Symbol {
    Variable(u32),
    Struct(u32),
    Function,
    /// Of a uniform block that has no name for its instance.
    Member(u32, u32),
    Block,
}

#[derive(Clone, Copy)]
pub enum Word {
    Free,
    Keyword,
    Type(Type),
}

/// And the depth of its scope.
type Binding = Option<(Symbol, usize)>;

pub struct Parser<'a> {
    pub shader: Shader,
    pub names: &'a Names<'a>,
    pub limits: Limits,
    pub is_webgl2: bool,
    pub is_all_invariant: bool,
    rest: &'a [Token],
    words: Vec<Word>,
    bindings: Vec<Binding>,
    hidden: Vec<(Name, Binding)>,
    /// How much was hidden before, and the default precisions.
    scopes: Vec<(usize, [Precision; 18])>,
    pub fields: HashMap<(u32, Name), u32>,
    pub signatures: HashMap<(Name, Vec<Type>), u32>,
    pub function: Option<u32>,
    /// For each variable, one more than the last function that used it.
    pub last_users: Vec<u32>,
    /// A global variable, and one that its initializer reads.
    pub global_uses: Vec<(u32, u32)>,
    pub returns_value: bool,
    pub loop_indices: Vec<u32>,
    pub is_row_major: bool,
    pub private_scalars: u32,
    /// Of the function so far.
    pub size: u32,
    pub nesting: usize,
    loops: usize,
    switches: usize,
    depth: usize,
}

pub fn precedence(operator: Known) -> Option<u8> {
    Some(match operator {
        Known::Or => 0,
        Known::Xor => 1,
        Known::And => 2,
        Known::Bar => 3,
        Known::Caret => 4,
        Known::Ampersand => 5,
        Known::Equal | Known::NotEqual => 6,
        Known::Less | Known::Greater | Known::LessEqual | Known::GreaterEqual => 7,
        Known::ShiftLeft | Known::ShiftRight => 8,
        Known::Plus | Known::Minus => 9,
        Known::Star | Known::Slash | Known::Percent => 10,
        _ => return None,
    })
}

fn precision_slot(base: Base) -> Option<usize> {
    match base {
        Base::Number(Scalar::Float) => Some(0),
        Base::Number(Scalar::Int | Scalar::Uint) => Some(1),
        Base::Sampler(dimension, result) => Some(2 + dimension as usize * 4 + result as usize),
        _ => None,
    }
}

pub fn parse(stage: Stage, source: &Output, names: &Names, options: &Options) -> Result<Shader> {
    let (is_es3, extensions) = (source.is_es3, source.extensions);
    let mut words = vec![Word::Free; names.len()];
    let keywords = builtins::keywords(is_es3).map(|it| (it, Word::Keyword));
    for (text, word) in keywords.chain(
        TYPES
            .iter()
            .filter(|it| it.1 || is_es3)
            .map(|it| (it.0, Word::Type(it.2))),
    ) {
        names.find(text).inspect(|it| words[it.0 as usize] = word);
    }
    let mut precisions = [Precision::None; 18];
    precisions[..2].copy_from_slice(&if stage == Stage::Vertex {
        [Precision::High; 2]
    } else {
        [Precision::None, Precision::Medium]
    });
    (precisions[2], precisions[2 + Dimension::Cube as usize * 4]) =
        (Precision::Low, Precision::Low);
    let draw_buffers = if options.is_webgl2 || options.extensions & DRAW_BUFFERS != 0 {
        options.limits.draw_buffers
    } else {
        1
    };
    let (structs, variables, functions, expressions, values, globals, order) = Default::default();
    let mut it = Parser {
        shader: Shader {
            stage,
            is_es3,
            extensions,
            structs,
            variables,
            functions,
            expressions,
            values,
            globals,
            order,
            depth_layout: None,
        },
        names,
        limits: Limits {
            draw_buffers,
            ..options.limits.clone()
        },
        is_webgl2: options.is_webgl2,
        is_all_invariant: source.is_all_invariant,
        rest: &source.tokens,
        words,
        bindings: vec![None; names.len()],
        hidden: Vec::new(),
        scopes: vec![(0, precisions)],
        fields: HashMap::new(),
        signatures: HashMap::new(),
        function: None,
        last_users: Vec::new(),
        global_uses: Vec::new(),
        returns_value: false,
        loop_indices: Vec::new(),
        is_row_major: false,
        private_scalars: 0,
        size: 0,
        nesting: 0,
        loops: 0,
        switches: 0,
        depth: 0,
    };
    if it.is_all_invariant && is_es3 && stage == Stage::Fragment {
        return it.fail("only a vertex shader can make all outputs invariant");
    }
    it.predeclare();
    it.enter();
    while it.peek().kind != Kind::End {
        it.declaration(&mut Vec::new())?;
    }
    it.finish()?;
    Ok(it.shader)
}

impl<'a> Parser<'a> {
    pub fn peek(&self) -> Token {
        self.rest[0]
    }

    pub fn advance(&mut self) -> Token {
        let token = self.rest[0];
        if let [_, _, ..] = self.rest {
            self.rest = &self.rest[1..];
        }
        token
    }

    pub fn word(&self, token: Token) -> Word {
        self.words[token.name.0 as usize]
    }

    /// The next token, if it is a punctuator or a keyword.
    pub fn next(&self) -> Known {
        let token = self.peek();
        if token.kind == Kind::Punctuator || matches!(self.word(token), Word::Keyword) {
            token.known()
        } else {
            Known::Other
        }
    }

    pub fn is_followed_by(&self, known: Known) -> bool {
        self.rest.get(1).is_some_and(|it| it.is(known))
    }

    pub fn eat(&mut self, known: Known) -> bool {
        self.next() == known && self.advance().is(known)
    }

    pub fn expect(&mut self, known: Known) -> Result<()> {
        if self.eat(known) {
            Ok(())
        } else {
            self.fail("syntax error")
        }
    }

    pub fn identifier(&mut self) -> Result<Token> {
        let token = self.peek();
        if token.kind == Kind::Identifier && matches!(self.word(token), Word::Free) {
            Ok(self.advance())
        } else {
            self.fail("syntax error")
        }
    }

    pub fn text(&self, token: Token) -> &'a str {
        self.names.text(token.name)
    }

    pub fn fail_at<T>(&self, token: Token, message: &str) -> Result<T> {
        Err(Error::new(token.line, self.text(token), message))
    }

    pub fn fail<T>(&self, message: &str) -> Result<T> {
        self.fail_at(self.peek(), message)
    }

    pub fn require(&self, is_met: bool, token: Token, message: &str) -> Result<()> {
        if is_met {
            Ok(())
        } else {
            self.fail_at(token, message)
        }
    }

    pub fn has(&self, extension: Extensions) -> bool {
        self.shader.extensions & extension != 0
    }

    pub fn nested<T>(&mut self, parse: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        self.depth += 1;
        self.nesting = self.nesting.max(self.depth);
        let result = if self.depth > MAX_DEPTH {
            self.fail("nested too deeply")
        } else {
            parse(self)
        };
        self.depth -= 1;
        result
    }

    pub fn enter(&mut self) {
        self.scopes
            .push((self.hidden.len(), self.scopes[self.scopes.len() - 1].1));
    }

    pub fn leave(&mut self) {
        let before = self.scopes.pop().map_or(0, |it| it.0);
        for (name, binding) in self.hidden.drain(before..).rev() {
            self.bindings[name.0 as usize] = binding;
        }
    }

    pub fn find(&self, token: Token) -> Option<Symbol> {
        self.bindings[token.name.0 as usize].map(|it| it.0)
    }

    pub fn require_unreserved(&self, name: Token) -> Result<()> {
        self.require(
            !["gl_", "webgl_", "_webgl_"]
                .iter()
                .any(|it| self.text(name).starts_with(it)),
            name,
            "the prefix is reserved",
        )?;
        self.require(
            !self.text(name).contains("__"),
            name,
            "double underscores are reserved",
        )
    }

    pub fn bind(&mut self, name: Token, symbol: Symbol) -> Result<()> {
        self.require_unreserved(name)?;
        let before = self.bindings[name.name.0 as usize].replace((symbol, self.scopes.len()));
        self.hidden.push((name.name, before));
        self.require(
            before.is_none_or(|it| it.1 != self.scopes.len()),
            name,
            "redefinition",
        )
    }

    pub fn set_default_precision(
        &mut self,
        of: Type,
        precision: Precision,
        at: Token,
    ) -> Result<()> {
        let slot = precision_slot(of.base).filter(|_| of == Type::of(of.base) && of != Type::UINT);
        let (Some(slot), Some(scope)) = (slot, self.scopes.last_mut()) else {
            return self.fail_at(at, "only float, int and samplers have a default precision");
        };
        scope.1[slot] = precision;
        Ok(())
    }

    pub fn precision_for(&self, of: Type, given: Precision, at: Token) -> Result<Precision> {
        let Some(slot) = precision_slot(of.base) else {
            return self
                .require(given == Precision::None, at, "this type has no precision")
                .map(|()| given);
        };
        let precision = if given == Precision::None {
            self.scopes[self.scopes.len() - 1].1[slot]
        } else {
            given
        };
        self.require(
            precision != Precision::None,
            at,
            "the precision is missing, and there is no default",
        )
        .map(|()| precision)
    }

    pub fn add_variable(&mut self, variable: Variable) -> u32 {
        self.shader.variables.push(variable);
        self.last_users.push(0);
        self.shader.variables.len() as u32 - 1
    }

    fn predeclare(&mut self) {
        let fields = ["near", "far", "diff"].map(|it| Field {
            name: it.into(),
            of: Type::FLOAT,
            precision: Precision::High,
            is_row_major: false,
            offset: 0,
        });
        for (index, field) in (0..).zip(&fields) {
            self.names
                .find(&field.name)
                .map(|it| self.fields.insert((0, it), index));
        }
        let range = self
            .shader
            .describe("gl_DepthRangeParameters", fields.into());
        self.names
            .find(&range.name)
            .inspect(|it| self.bindings[it.0 as usize] = Some((Symbol::Struct(0), 1)));
        self.shader.structs.push(range);
        for it in VARIABLES {
            let Some(name) = self.names.find(it.name).filter(|_| {
                it.condition.is_met(
                    self.shader.stage,
                    self.shader.is_es3,
                    self.shader.extensions,
                )
            }) else {
                continue;
            };
            let number = (it.number)(&self.limits);
            let mut variable = Variable::new(
                it.name,
                if it.of.length == 1 {
                    it.of.array(number)
                } else {
                    it.of
                },
                it.storage,
                Precision::High,
            );
            variable.value =
                (it.storage == Storage::Constant).then(|| self.shader.add_values([number]));
            (variable.is_builtin, variable.is_invariant) =
                (true, self.is_all_invariant && it.storage == Storage::Output);
            let index = self.add_variable(variable);
            self.bindings[name.0 as usize] = Some((Symbol::Variable(index), 1));
        }
    }

    fn starts_declaration(&self) -> bool {
        let token = self.peek();
        match (self.word(token), self.find(token)) {
            (Word::Keyword, _) => !matches!(token.known(), Known::True | Known::False),
            (Word::Type(_), _) | (_, Some(Symbol::Struct(_))) => {
                let mut depth = 0;
                let mut is_size = |it: &&Token| {
                    depth += i32::from(it.is(Known::LeftBracket))
                        - i32::from(it.is(Known::RightBracket));
                    depth > 0 || it.is(Known::RightBracket)
                };
                !self.rest[1..]
                    .iter()
                    .find(|it| !is_size(it))
                    .is_some_and(|it| it.is(Known::LeftParen))
            }
            _ => false,
        }
    }

    /// From the opening brace on, in the current scope.
    pub fn block(&mut self) -> Result<Vec<Statement>> {
        self.expect(Known::LeftBrace)?;
        let mut all = Vec::new();
        while !self.eat(Known::RightBrace) {
            self.statement(&mut all)?;
        }
        Ok(all)
    }

    /// In the current scope.
    fn body(&mut self) -> Result<Box<Statement>> {
        let mut all = Vec::new();
        if self.next() == Known::LeftBrace {
            all = self.nested(Self::block)?;
        } else {
            self.statement(&mut all)?;
        }
        Ok(Box::new(Statement::Block(all)))
    }

    fn scoped<T>(&mut self, parse: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        self.enter();
        let result = parse(self);
        self.leave();
        result
    }

    fn boolean(&mut self) -> Result<Id> {
        let (at, id) = (self.peek(), self.expression()?);
        self.require(
            self.type_of(id) == Type::BOOL,
            at,
            "the condition is no bool",
        )
        .map(|()| id)
    }

    fn statement(&mut self, out: &mut Vec<Statement>) -> Result<()> {
        let (token, known) = (self.peek(), self.next());
        let statement = match known {
            Known::LeftBrace => *self.scoped(Self::body)?,
            Known::If => self.nested(Self::selection)?,
            Known::For | Known::While | Known::Do => {
                self.nested(|it| it.scoped(Self::iteration))?
            }
            Known::Switch if self.shader.is_es3 => self.nested(|it| it.scoped(Self::switch))?,
            Known::Break | Known::Continue | Known::Discard => {
                let is_valid = match known {
                    Known::Break => self.loops + self.switches > 0,
                    Known::Continue => self.loops > 0,
                    _ => self.shader.stage == Stage::Fragment,
                };
                self.require(is_valid, token, "statement is not allowed here")?;
                self.advance();
                self.expect(Known::Semicolon)?;
                Statement::Jump(known)
            }
            Known::Return => {
                self.advance();
                let value = if self.next() == Known::Semicolon {
                    None
                } else {
                    Some(self.expression()?)
                };
                let wanted = self
                    .function
                    .map_or(Type::VOID, |it| self.shader.functions[it as usize].returns);
                let is_valid = value.map_or(wanted == Type::VOID, |it| {
                    wanted != Type::VOID && self.type_of(it) == wanted
                });
                self.require(is_valid, token, "the function has another result")?;
                self.returns_value = true;
                self.expect(Known::Semicolon)?;
                Statement::Return(value)
            }
            Known::Semicolon => return self.expect(Known::Semicolon),
            _ if self.starts_declaration() => return self.declaration(out),
            _ => {
                let id = self.expression()?;
                self.expect(Known::Semicolon)?;
                Statement::Evaluate(id)
            }
        };
        out.push(statement);
        Ok(())
    }

    fn selection(&mut self) -> Result<Statement> {
        self.advance();
        self.expect(Known::LeftParen)?;
        let condition = self.boolean()?;
        self.expect(Known::RightParen)?;
        let then = self.scoped(Self::body)?;
        Ok(Statement::If(
            condition,
            then,
            if self.eat(Known::Else) {
                Some(self.scoped(Self::body)?)
            } else {
                None
            },
        ))
    }

    fn condition(&mut self, before: &mut Vec<Statement>) -> Result<Id> {
        if !self.starts_declaration() {
            return self.boolean();
        }
        let at = self.peek();
        let (variable, value) = self.initialized()?;
        self.require(
            self.type_of(value) == Type::BOOL,
            at,
            "the condition is no bool",
        )?;
        if self.shader.variables[variable as usize].value.is_some() {
            return Ok(value);
        }
        before.push(Statement::Declare(variable, None));
        let target = self.read(variable, at)?;
        self.assign(at, Known::Assign, target, value)
    }

    fn iteration(&mut self) -> Result<Statement> {
        let keyword = self.advance();
        self.require(
            self.shader.is_es3 || keyword.is(Known::For),
            keyword,
            "version 100 only has for loops",
        )?;
        self.loops += 1;
        if keyword.is(Known::Do) {
            let body = self.body()?;
            self.loops -= 1;
            self.leave();
            self.enter();
            self.expect(Known::While)?;
            self.expect(Known::LeftParen)?;
            let condition = self.boolean()?;
            self.expect(Known::RightParen)?;
            self.expect(Known::Semicolon)?;
            return Ok(Statement::DoWhile(body, condition));
        }
        self.expect(Known::LeftParen)?;
        let (mut before, mut condition, mut step) = (Vec::new(), None, None);
        if keyword.is(Known::While) {
            condition = Some(self.condition(&mut before)?);
        } else {
            if self.starts_declaration() {
                self.declaration(&mut before)?;
            } else if !self.eat(Known::Semicolon) {
                before.push(Statement::Evaluate(self.expression()?));
                self.expect(Known::Semicolon)?;
            }
            if self.next() != Known::Semicolon {
                condition = Some(self.condition(&mut before)?);
            }
            self.expect(Known::Semicolon)?;
            if self.next() != Known::RightParen {
                step = Some(self.expression()?);
            }
        }
        self.expect(Known::RightParen)?;
        let indices = self.loop_indices.len();
        if !self.shader.is_es3 {
            let Some(index) = self.index_of_loop(&before, condition, step) else {
                return self.fail_at(
                    keyword,
                    "version 100 only has loops with constant bounds and steps",
                );
            };
            self.loop_indices.push(index);
        }
        let body = self.body()?;
        self.loop_indices.truncate(indices);
        self.loops -= 1;
        let is_finite = self.is_finite(&before, condition, step) == Some(true);
        before.push(Statement::Loop {
            condition,
            step,
            body,
            is_finite,
        });
        Ok(Statement::Block(before))
    }

    /// If it has the only form that GLSL ES 1.00 asks for.
    fn index_of_loop(
        &self,
        before: &[Statement],
        condition: Option<Id>,
        step: Option<Id>,
    ) -> Option<u32> {
        let &[Statement::Declare(index, Some(first))] = before else {
            return None;
        };
        let at = |id: Id| &self.shader.expressions[id as usize];
        let is_index = |id| matches!(at(id).node, Node::Variable(it) if it == index);
        let is_with_constant = |left, right| is_index(left) && at(right).value.is_some();
        let has_condition = matches!(at(condition?).node, Node::Binary(operator, left, right) if matches!(precedence(operator), Some(6 | 7)) && is_with_constant(left, right));
        let has_step = match at(step?).node {
            Node::Prefix(Known::Increment | Known::Decrement, it) | Node::Postfix(_, it) => {
                is_index(it)
            }
            Node::Binary(Known::AddAssign | Known::SubtractAssign, left, right) => {
                is_with_constant(left, right)
            }
            _ => false,
        };
        (matches!(at(first).of, Type::INT | Type::FLOAT)
            && at(first).value.is_some()
            && has_condition
            && has_step)
            .then_some(index)
    }

    /// Only the step changes the index, which gets to the limit before it is out of range.
    fn is_finite(
        &self,
        before: &[Statement],
        condition: Option<Id>,
        step: Option<Id>,
    ) -> Option<bool> {
        let &[Statement::Declare(index, Some(first))] = before else {
            return None;
        };
        let at = |id: Id| &self.shader.expressions[id as usize];
        let number = |id| {
            let bits = self.shader.values[at(id).value?.start as usize];
            Some(match at(id).of {
                Type::INT => f64::from(bits as i32),
                Type::UINT => bits.into(),
                _ => f32::from_bits(bits).into(),
            })
        };
        let (stepped, by) = match at(step?).node {
            Node::Prefix(Known::Increment, it) | Node::Postfix(Known::Increment, it) => (it, 1.),
            Node::Prefix(Known::Decrement, it) | Node::Postfix(Known::Decrement, it) => (it, -1.),
            Node::Binary(Known::AddAssign, it, by) => (it, number(by)?),
            Node::Binary(Known::SubtractAssign, it, by) => (it, -number(by)?),
            _ => return None,
        };
        let Node::Binary(operator, compared, limit) = at(condition?).node else {
            return None;
        };
        let (is_strict, is_index) = (
            matches!(operator, Known::Less | Known::Greater),
            |id| matches!(at(id).node, Node::Variable(it) if it == index),
        );
        let gets_closer = if by > 0. {
            matches!(operator, Known::Less | Known::LessEqual)
        } else {
            by < 0. && matches!(operator, Known::Greater | Known::GreaterEqual)
        };
        let stays_in = |least: f64, most: f64| {
            is_strict && by.abs() == 1.
                || number(limit).is_some_and(|it| (least..=most).contains(&(it + by)))
        };
        let is_in_range = match at(first).of {
            Type::INT => stays_in(i32::MIN.into(), i32::MAX.into()),
            Type::UINT => stays_in(0., u32::MAX.into()),
            _ => number(first)?.abs().max(number(limit)?.abs()) < by.abs() * f64::from(1 << 20),
        };
        Some(
            is_index(stepped)
                && is_index(compared)
                && self.shader.variables[index as usize].writes.get() == 1
                && gets_closer
                && is_in_range,
        )
    }

    fn switch(&mut self) -> Result<Statement> {
        let keyword = self.advance();
        self.expect(Known::LeftParen)?;
        let selector = self.expression()?;
        let of = self.type_of(selector);
        self.require(
            matches!(of, Type::INT | Type::UINT),
            keyword,
            "the selector is no int or uint",
        )?;
        self.expect(Known::RightParen)?;
        self.expect(Known::LeftBrace)?;
        self.switches += 1;
        let (mut all, mut labels) = (Vec::new(), Vec::new());
        while !self.eat(Known::RightBrace) {
            let label = self.peek();
            if self.eat(Known::Case) {
                let id = self.expression()?;
                let Some(value) = self.integer_value(id).filter(|_| self.type_of(id) == of) else {
                    return self.fail_at(
                        label,
                        "the label is no constant of the type of the selector",
                    );
                };
                labels.push(Some(value));
                all.push(Statement::Case(Some(id)));
            } else if self.eat(Known::Default) {
                labels.push(None);
                all.push(Statement::Case(None));
            } else {
                self.require(
                    !labels.is_empty(),
                    label,
                    "a switch has to start with a label",
                )?;
                self.statement(&mut all)?;
                continue;
            }
            self.expect(Known::Colon)?;
            self.require(
                self.next() != Known::RightBrace,
                label,
                "nothing follows the last label",
            )?;
        }
        self.switches -= 1;
        labels.sort_unstable();
        self.require(
            labels.len() <= MAX_LABELS && labels.array_windows().all(|[a, b]| a != b),
            keyword,
            "a label is repeated, or there are too many",
        )?;
        Ok(Statement::Switch(selector, all))
    }

    /// Puts the callees of a function before it. Returns how large it is with them, how deep its calls go, and how deeply it is nested with them.
    fn visit(
        &self,
        function: u32,
        depth: usize,
        visited: &mut [Option<(u32, usize, usize)>],
        order: &mut Vec<u32>,
    ) -> Result<(u32, usize, usize)> {
        let it = &self.shader.functions[function as usize];
        let fail = |message| Err(Error::new(self.peek().line, &it.name, message));
        if let Some(known) = visited[function as usize] {
            return Ok(known);
        }
        if it.body.is_none() {
            return fail("it is called, but has no body");
        }
        let mut total = (it.size, 0, it.nesting);
        for &callee in &it.calls {
            let (size, below, nesting) = if depth < MAX_DEPTH {
                self.visit(callee, depth + 1, visited, order)?
            } else {
                (0, MAX_DEPTH, 0)
            };
            total = (
                total.0.saturating_add(size),
                total.1.max(below + 1),
                total.2.max(it.nesting + nesting),
            );
            if total.1 > MAX_DEPTH {
                return fail("it calls itself, or calls go too deep");
            }
        }
        visited[function as usize] = Some(total);
        order.push(function);
        Ok(total)
    }

    fn finish(&mut self) -> Result<()> {
        let main = self
            .signatures
            .get(&(Known::Main.into(), Vec::new()))
            .filter(|it| self.shader.functions[**it as usize].body.is_some());
        let Some(&main) = main else {
            return self.fail("there is no main function");
        };
        let (mut visited, mut order) = (vec![None; self.shader.functions.len()], Vec::new());
        let (size, _, nesting) = self.visit(main, 0, &mut visited, &mut order)?;
        self.require(
            size <= MAX_INLINED && nesting <= MAX_INLINED_NESTING && order.len() <= MAX_FUNCTIONS,
            self.peek(),
            "the shader is too large with all that it calls",
        )?;
        for (index, _) in (0..)
            .zip(&self.shader.functions)
            .filter(|it| it.1.body.is_some())
        {
            self.visit(index, 0, &mut visited, &mut Vec::new())?;
        }
        let shader = &mut self.shader;
        for variable in order
            .iter()
            .flat_map(|it| &shader.functions[*it as usize].uses)
        {
            shader.variables[*variable as usize].is_active = true;
        }
        shader.order = order;
        for &(user, used) in self.global_uses.iter().rev() {
            shader.variables[used as usize].is_active |= shader
                .variables
                .get(user as usize)
                .is_some_and(|it| it.is_active);
        }
        self.check_interface()
    }
}
