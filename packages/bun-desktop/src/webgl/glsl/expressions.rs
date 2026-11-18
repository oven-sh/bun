//! From tokens to a tree: expressions.

use super::builtins::{self, Builtin, Role};
use super::fold::{self, Operand};
use super::lexer::{self, Kind, Known, Token};
use super::parser::{Parser, Symbol, Word, precedence};
use super::tree::*;
use super::{DRAW_BUFFERS, MAX_DEPTH, Result, Stage};

const MAX_VALUES: usize = 1 << 22;

fn operator_of_assignment(known: Known) -> Option<Known> {
    Some(match known {
        Known::Assign => Known::Assign,
        Known::AddAssign => Known::Plus,
        Known::SubtractAssign => Known::Minus,
        Known::MultiplyAssign => Known::Star,
        Known::DivideAssign => Known::Slash,
        Known::ModuloAssign => Known::Percent,
        Known::ShiftLeftAssign => Known::ShiftLeft,
        Known::ShiftRightAssign => Known::ShiftRight,
        Known::AndAssign => Known::Ampersand,
        Known::OrAssign => Known::Bar,
        Known::XorAssign => Known::Caret,
        _ => return None,
    })
}

impl Parser<'_> {
    fn at(&self, id: Id) -> &Expression {
        &self.shader.expressions[id as usize]
    }

    pub fn type_of(&self, id: Id) -> Type {
        self.at(id).of
    }

    fn operand(&self, id: Id) -> Option<Operand<'_>> {
        Some((
            self.at(id).of,
            &self.shader.values[self.at(id).value?.range()],
        ))
    }

    fn operands(&self, ids: &[Id]) -> Option<Vec<Operand<'_>>> {
        ids.iter().map(|it| self.operand(*it)).collect()
    }

    pub fn integer_value(&self, id: Id) -> Option<u32> {
        self.operand(id)
            .filter(|it| matches!(it.0, Type::INT | Type::UINT))
            .map(|it| it.1[0])
    }

    fn add(&mut self, node: Node, of: Type, value: Option<Values>, parts: &[Id]) -> Result<Id> {
        let (is_constant, is_literal) = (value.is_some(), value.is_some() && of.scalar().is_some());
        let choices = parts
            .iter()
            .filter(|_| matches!(node, Node::Call(..) | Node::Builtin(..)))
            .flat_map(|it| self.shader.choices(*it));
        let (steps, copies) = choices.fold((1, 1), |(steps, copies): (u16, u32), it| {
            (steps + 1, copies.saturating_mul(it))
        });
        let parts = parts.iter().map(|it| self.at(*it));
        let (depth, once) = if is_literal {
            (0, 1)
        } else {
            (
                parts.clone().map(|it| it.depth).max().unwrap_or(0) + steps,
                parts
                    .clone()
                    .fold(1, |all: u32, it| all.saturating_add(it.weight)),
            )
        };
        let writes = match &node {
            Node::Prefix(operator, _) => matches!(operator, Known::Increment | Known::Decrement),
            Node::Binary(operator, ..) => operator_of_assignment(*operator).is_some(),
            Node::Builtin(it, _) => it.roles.contains(&Role::Written),
            node => matches!(node, Node::Postfix(..) | Node::Call(..)),
        };
        let (is_index, is_global) = match node {
            Node::Variable(it) => (
                self.loop_indices.contains(&it),
                matches!(
                    self.shader.variables[it as usize].storage,
                    Storage::Global | Storage::Uniform
                ),
            ),
            Node::Builtin(it, _) => (!it.reads_texture(), !it.reads_texture()),
            _ => (!writes, !writes),
        };
        let expression = Expression {
            has_effects: writes || parts.clone().any(|it| it.has_effects),
            is_constant_index: is_constant
                || is_index && parts.clone().all(|it| it.is_constant_index),
            can_initialize_global: is_constant
                || is_global && parts.clone().all(|it| it.can_initialize_global),
            node: if is_literal { Node::Constant } else { node },
            of,
            value,
            depth,
            weight: once.saturating_mul(copies),
        };
        self.size = self.size.saturating_add(expression.weight - once + 1);
        if usize::from(depth) > MAX_DEPTH || self.shader.values.len() > MAX_VALUES {
            return self.fail("the expression is too deep, or there are too many constants");
        }
        self.shader.expressions.push(expression);
        Ok(self.shader.expressions.len() as Id - 1)
    }

    fn add_folded(
        &mut self,
        node: Node,
        of: Type,
        values: Option<Vec<u32>>,
        parts: &[Id],
    ) -> Result<Id> {
        let value = values.map(|it| self.shader.add_values(it));
        self.add(node, of, value, parts)
    }

    fn constant(&mut self, of: Type, bits: u32) -> Result<Id> {
        self.add_folded(Node::Constant, of, Some(vec![bits]), &[])
    }

    /// Of the value of `whole`, if it has one.
    fn part(&self, whole: Id, before: u32, of: Type) -> Option<Values> {
        self.at(whole).value.map(|it| Values {
            start: it.start + before,
            end: it.start + before + self.shader.scalars(of),
        })
    }

    pub fn read(&mut self, variable: u32, at: Token) -> Result<Id> {
        let it = &mut self.shader.variables[variable as usize];
        let (of, value) = (it.of, it.value);
        it.is_used = true;
        match self.function {
            _ if matches!(it.storage, Storage::Local | Storage::Parameter(_)) => {}
            Some(function)
                if std::mem::replace(&mut self.last_users[variable as usize], function + 1)
                    == function + 1 => {}
            Some(function) => self.shader.functions[function as usize].uses.push(variable),
            None => self
                .global_uses
                .push((self.shader.variables.len() as u32, variable)),
        }
        self.require(
            of.length != UNSIZED || self.next() == Known::LeftBracket,
            at,
            "must be redeclared with a size, or be indexed with a constant",
        )?;
        self.add(Node::Variable(variable), of, value, &[])
    }

    fn require_writable(&self, id: Id, at: Token) -> Result<()> {
        match self.at(id).node {
            Node::Variable(it) => {
                let Variable {
                    storage, writes, ..
                } = &self.shader.variables[it as usize];
                writes.update(|it| it + 1);
                let is_writable = matches!(
                    storage,
                    Storage::Local
                        | Storage::Global
                        | Storage::Output
                        | Storage::Parameter(Direction::In | Direction::Out | Direction::InOut)
                );
                self.require(
                    is_writable
                        && !self.loop_indices.contains(&it)
                        && !self.shader.has_samplers(self.type_of(id)),
                    at,
                    "it cannot be written",
                )
            }
            Node::Swizzle(whole, components) => {
                let components = &components[..self.type_of(id).rows.into()];
                let distinct = components
                    .iter()
                    .fold(0u8, |all, it| all | 1 << it)
                    .count_ones();
                self.require(
                    distinct as usize == components.len(),
                    at,
                    "a component would be written twice",
                )?;
                self.require_writable(whole, at)
            }
            Node::Index(whole, _) | Node::Field(whole, _) => self.require_writable(whole, at),
            _ => self.fail_at(at, "it cannot be written"),
        }
    }

    pub fn expression(&mut self) -> Result<Id> {
        let mut left = self.assignment()?;
        while self.next() == Known::Comma {
            let (at, right) = (self.advance(), self.assignment()?);
            let is_banned = |id| {
                self.shader.has_samplers(self.type_of(id))
                    || self.is_webgl2
                        && (self.type_of(id) == Type::VOID
                            || self.shader.has_arrays(self.type_of(id)))
            };
            self.require(
                !is_banned(left) && !is_banned(right),
                at,
                "an operand has a type that cannot be in a sequence",
            )?;
            let value = self
                .at(right)
                .value
                .filter(|_| !self.shader.is_es3 && self.at(left).value.is_some());
            left = self.add(
                Node::Binary(Known::Comma, left, right),
                self.type_of(right),
                value,
                &[left, right],
            )?;
        }
        Ok(left)
    }

    pub fn assignment(&mut self) -> Result<Id> {
        self.nested(|it| {
            let left = it.conditional()?;
            if operator_of_assignment(it.next()).is_none() {
                return Ok(left);
            }
            let (at, right) = (it.advance(), it.assignment()?);
            it.assign(at, at.known(), left, right)
        })
    }

    pub fn can_be_copied(&self, of: Type) -> bool {
        of != Type::VOID
            && !self.shader.has_samplers(of)
            && (self.shader.is_es3 || !self.shader.has_arrays(of))
    }

    pub fn assign(&mut self, at: Token, operator: Known, left: Id, right: Id) -> Result<Id> {
        let of = self.type_of(left);
        let result = match operator_of_assignment(operator) {
            Some(Known::Assign) | None => {
                Some(self.type_of(right)).filter(|it| self.can_be_copied(*it))
            }
            Some(operator) => self.result_of(operator, of, self.type_of(right)),
        };
        self.require(
            result == Some(of),
            at,
            "the value does not have the type of the variable",
        )?;
        self.require_writable(left, at)?;
        self.add(
            Node::Binary(operator, left, right),
            of,
            None,
            &[left, right],
        )
    }

    pub fn conditional(&mut self) -> Result<Id> {
        let condition = self.binary(0)?;
        if self.next() != Known::Question {
            return Ok(condition);
        }
        let (at, then) = (self.advance(), self.expression()?);
        self.expect(Known::Colon)?;
        let otherwise = self.assignment()?;
        let of = self.type_of(then);
        self.require(
            self.type_of(condition) == Type::BOOL,
            at,
            "the condition is no bool",
        )?;
        self.require(
            of == self.type_of(otherwise),
            at,
            "the alternatives have different types",
        )?;
        self.require(
            of.scalar().is_some() || of == Type::VOID && !self.is_webgl2,
            at,
            "there is no choice between values of this type",
        )?;
        let value = self.operands(&[condition, then, otherwise]).and_then(|it| {
            self.at(if it[0].1[0] != 0 { then } else { otherwise })
                .value
        });
        self.add(
            Node::Conditional(condition, then, otherwise),
            of,
            value,
            &[condition, then, otherwise],
        )
    }

    fn result_of(&self, operator: Known, left: Type, right: Type) -> Option<Type> {
        let is_same_kind = left.scalar() == right.scalar();
        let shape = if left == right || right.is_scalar() {
            Some(left)
        } else {
            left.is_scalar().then_some(right)
        };
        let are_integers = self.shader.is_es3 && left.is_integer() && right.is_integer();
        match operator {
            Known::And | Known::Or | Known::Xor => {
                (left == Type::BOOL && right == Type::BOOL).then_some(Type::BOOL)
            }
            Known::Equal | Known::NotEqual => {
                (left == right && self.can_be_copied(left)).then_some(Type::BOOL)
            }
            Known::Less | Known::Greater | Known::LessEqual | Known::GreaterEqual => {
                (left == right && left.is_scalar() && left.is_arithmetic()).then_some(Type::BOOL)
            }
            Known::ShiftLeft | Known::ShiftRight => {
                (are_integers && (right.rows == 1 || right.rows == left.rows)).then_some(left)
            }
            Known::Percent | Known::Ampersand | Known::Bar | Known::Caret => {
                shape.filter(|_| are_integers && is_same_kind)
            }
            _ if !left.is_arithmetic() || !is_same_kind => None,
            Known::Star if left.is_matrix() && !right.is_scalar() => (left.columns == right.rows)
                .then_some(Type {
                    rows: left.rows,
                    ..right
                }),
            Known::Star if right.is_matrix() && !left.is_scalar() => (left.rows == right.rows)
                .then_some(Type {
                    rows: right.columns,
                    ..left
                }),
            _ => shape,
        }
    }

    fn are_equal(&self, (of, left): Operand, right: &[u32]) -> bool {
        let mut at = 0;
        self.shader.leaves(of, &mut Vec::new(), &mut |_, leaf| {
            let range = at..at + self.shader.scalars(leaf) as usize;
            at = range.end;
            range
                .into_iter()
                .all(|it| fold::is_equal(leaf.element().scalar(), left[it], right[it]))
        })
    }

    fn binary(&mut self, weakest: u8) -> Result<Id> {
        let mut left = self.unary()?;
        while let operator = self.next()
            && let Some(strength) = precedence(operator).filter(|it| *it >= weakest)
        {
            let (at, right) = (self.advance(), self.binary(strength + 1)?);
            let Some(of) = self.result_of(operator, self.type_of(left), self.type_of(right)) else {
                return self.fail_at(at, "it is not defined for these types");
            };
            let values = self
                .operand(left)
                .zip(self.operand(right))
                .map(|(a, b)| match operator {
                    Known::Equal | Known::NotEqual => {
                        vec![(self.are_equal(a, b.1) == (operator == Known::Equal)).into()]
                    }
                    _ => fold::binary(operator, a, b),
                });
            left = self.add_folded(
                Node::Binary(operator, left, right),
                of,
                values,
                &[left, right],
            )?;
        }
        Ok(left)
    }

    fn unary(&mut self) -> Result<Id> {
        let operator = self.next();
        if !matches!(
            operator,
            Known::Increment
                | Known::Decrement
                | Known::Plus
                | Known::Minus
                | Known::Not
                | Known::Tilde
        ) {
            return self.postfix();
        }
        let (at, operand) = (self.advance(), self.nested(Self::unary)?);
        let of = self.type_of(operand);
        let is_valid = match operator {
            Known::Not => of == Type::BOOL,
            Known::Tilde => of.is_integer() && self.shader.is_es3,
            _ => of.is_arithmetic(),
        };
        self.require(is_valid, at, "it is not defined for this type")?;
        if matches!(operator, Known::Increment | Known::Decrement) {
            self.require_writable(operand, at)?;
        }
        let values = self.operand(operand).map(|it| fold::prefix(operator, it));
        self.add_folded(Node::Prefix(operator, operand), of, values, &[operand])
    }

    fn postfix(&mut self) -> Result<Id> {
        let mut id = self.primary()?;
        loop {
            let at = self.peek();
            id = match self.next() {
                Known::LeftBracket => {
                    self.advance();
                    let index = self.expression()?;
                    self.expect(Known::RightBracket)?;
                    self.index(at, id, index)?
                }
                Known::Dot => {
                    self.advance();
                    self.select(id)?
                }
                operator @ (Known::Increment | Known::Decrement) => {
                    self.advance();
                    self.require(
                        self.type_of(id).is_arithmetic(),
                        at,
                        "it is not defined for this type",
                    )?;
                    self.require_writable(id, at)?;
                    self.add(Node::Postfix(operator, id), self.type_of(id), None, &[id])?
                }
                _ => {
                    return self
                        .require(
                            self.shader
                                .structure(self.type_of(id))
                                .is_none_or(|it| !it.is_block),
                            at,
                            "a block can only be used by its members",
                        )
                        .map(|()| id);
                }
            };
        }
    }

    fn index(&mut self, at: Token, whole: Id, index: Id) -> Result<Id> {
        let (of, root) = (self.type_of(whole), self.shader.root(whole));
        let (element, count) = match of {
            _ if of.length == UNSIZED => (
                of.element(),
                self.limits.distances[usize::from(root.is_some_and(|it| {
                    *self.shader.variables[it as usize].name == *"gl_CullDistance"
                }))],
            ),
            _ if of.is_array() => (of.element(), of.length),
            _ if of.is_matrix() => (Type { columns: 1, ..of }, of.columns.into()),
            _ if of.is_vector() => (Type { rows: 1, ..of }, of.rows.into()),
            _ => return self.fail_at(at, "this type has no elements"),
        };
        self.require(
            matches!(self.type_of(index), Type::INT | Type::UINT),
            at,
            "the index is no integer",
        )?;
        let (known, variable) = (
            self.integer_value(index),
            root.map(|it| &self.shader.variables[it as usize]),
        );
        let storage = variable.map(|it| it.storage);
        self.require(
            known.is_none_or(|it| it < count),
            at,
            "the index is too large",
        )?;
        if of.is_array()
            && variable.is_some_and(|it| *it.name == *"gl_FragData")
            && !self.has(DRAW_BUFFERS)
        {
            self.require(
                known == Some(0),
                at,
                "gl_FragData has one element without GL_EXT_draw_buffers",
            )?;
        } else if !self.shader.is_es3 {
            let is_free = storage == Some(Storage::Uniform)
                && self.shader.stage == Stage::Vertex
                && !self.shader.has_samplers(of);
            self.require(
                is_free || self.at(index).is_constant_index,
                at,
                "the index has to be made of constants and indices of loops",
            )?;
        } else if known.is_none() && of.is_array() {
            let is_color = storage == Some(Storage::Output)
                && self.shader.stage == Stage::Fragment
                && variable.is_some_and(|it| !it.is_builtin);
            let is_block = self.shader.structure(of).is_some_and(|it| it.is_block);
            self.require(
                !is_color && !is_block && !self.shader.has_samplers(of) && of.length != UNSIZED,
                at,
                "the index has to be a constant",
            )?;
        }
        if let (Node::Variable(it), true) = (&self.at(whole).node, of.is_array()) {
            let it = *it as usize;
            self.shader.variables[it].reach = self.shader.variables[it]
                .reach
                .max(known.map_or(count, |it| it + 1));
        }
        let value =
            known.and_then(|it| self.part(whole, it * self.shader.scalars(element), element));
        self.add(Node::Index(whole, index), element, value, &[whole, index])
    }

    fn field(&mut self, whole: Id, index: u32) -> Result<Id> {
        let fields = self
            .shader
            .structure(self.type_of(whole))
            .map_or(&[][..], |it| &it.fields);
        let Field { of, offset, .. } = fields[index as usize];
        self.add(
            Node::Field(whole, index),
            of,
            self.part(whole, offset, of),
            &[whole],
        )
    }

    fn select(&mut self, whole: Id) -> Result<Id> {
        let (of, name) = (self.type_of(whole), self.identifier()?);
        if self.eat(Known::LeftParen) {
            self.expect(Known::RightParen)?;
            self.require(
                name.is(Known::Length) && of.is_array() && self.shader.is_es3,
                name,
                "only arrays have a method, length()",
            )?;
            return if self.at(whole).has_effects {
                self.add(Node::Length(whole), Type::INT, None, &[whole])
            } else {
                self.constant(Type::INT, of.length)
            };
        }
        if let (Base::Struct(structure), false) = (of.base, of.is_array()) {
            let Some(&index) = self.fields.get(&(structure, name.name)) else {
                return self.fail_at(name, "there is no such member");
            };
            return self.field(whole, index);
        }
        let (text, mut components) = (self.text(name), [0; 4]);
        let set = ["xyzw", "rgba", "stpq"]
            .into_iter()
            .find(|set| text.chars().all(|it| set[..of.rows.into()].contains(it)));
        let Some(set) = set.filter(|_| of.is_vector() && text.len() <= 4) else {
            return self.fail_at(name, "there are no such components");
        };
        components
            .iter_mut()
            .zip(text.chars())
            .for_each(|(component, it)| *component = set.find(it).unwrap_or(0) as u8);
        let values = self.operand(whole).map(|it| {
            components[..text.len()]
                .iter()
                .map(|at| it.1[usize::from(*at)])
                .collect()
        });
        self.add_folded(
            Node::Swizzle(whole, components),
            Type {
                rows: text.len() as u8,
                ..of
            },
            values,
            &[whole],
        )
    }

    fn number(&mut self) -> Result<Id> {
        let (token, is_es3) = (self.advance(), self.shader.is_es3);
        let text = self.text(token);
        match (
            lexer::integer(text.trim_start_matches('-')),
            lexer::float(text, is_es3),
        ) {
            (Some((bits, false)), _) => self.constant(
                Type::INT,
                if text.starts_with('-') {
                    bits.wrapping_neg()
                } else {
                    bits
                },
            ),
            (Some((bits, true)), _) if is_es3 => self.constant(Type::UINT, bits),
            (None, Some(value)) => self.constant(
                Type::FLOAT,
                if is_es3 { value } else { value.min(f32::MAX) }.to_bits(),
            ),
            _ => self.fail_at(token, "malformed number"),
        }
    }

    fn primary(&mut self) -> Result<Id> {
        let token = self.peek();
        match (token.kind, self.next(), self.word(token), self.find(token)) {
            (Kind::Number, ..) => self.number(),
            (_, known @ (Known::True | Known::False), ..) => {
                self.advance();
                self.constant(Type::BOOL, (known == Known::True).into())
            }
            (_, Known::LeftParen, ..) => {
                self.advance();
                let id = self.expression()?;
                self.expect(Known::RightParen).map(|()| id)
            }
            (_, _, Word::Type(_), _) | (.., Some(Symbol::Struct(_))) => {
                let of = self.type_specifier()?.0;
                let arguments = self.arguments()?;
                self.construct(token, of, arguments)
            }
            (.., Some(Symbol::Function) | None) if self.is_followed_by(Known::LeftParen) => {
                self.identifier()?;
                let arguments = self.arguments()?;
                self.call(token, arguments)
            }
            (.., Some(Symbol::Variable(it))) => {
                self.advance();
                self.read(it, token)
            }
            (.., Some(Symbol::Member(block, index))) => {
                self.advance();
                let whole = self.read(block, token)?;
                self.field(whole, index)
            }
            _ => self
                .identifier()
                .and_then(|it| self.fail_at(it, "it is not declared")),
        }
    }

    fn arguments(&mut self) -> Result<Vec<Id>> {
        self.expect(Known::LeftParen)?;
        let mut all = Vec::new();
        if matches!(self.word(self.peek()), Word::Type(Type::VOID))
            && self.is_followed_by(Known::RightParen)
        {
            self.advance();
        }
        while !self.eat(Known::RightParen) {
            if !all.is_empty() {
                self.expect(Known::Comma)?;
            }
            all.push(self.assignment()?);
        }
        Ok(all)
    }

    fn construct(&mut self, at: Token, mut of: Type, arguments: Vec<Id>) -> Result<Id> {
        let types: Vec<_> = arguments.iter().map(|it| self.type_of(*it)).collect();
        if of.length == UNSIZED {
            of.length = types.len() as u32;
        }
        if of.scalar().is_none() {
            self.require_size(of, Storage::Local, at)?;
        }
        let is_valid = match (of.scalar(), &types[..]) {
            (_, []) => false,
            (Some(_), [only])
                if only.is_scalar() || only.is_matrix() && of.is_matrix() && !only.is_array() =>
            {
                true
            }
            (Some(_), [first @ .., last]) => {
                let before: u32 = first.iter().map(|it| it.components()).sum();
                let are_valid = types
                    .iter()
                    .all(|it| it.scalar().is_some() && !(it.is_matrix() && of.is_matrix()));
                are_valid
                    && before < of.components()
                    && before + last.components() >= of.components()
            }
            _ if !self.can_be_copied(of.element())
                && (self.shader.structure(of).is_none() || self.shader.has_samplers(of)) =>
            {
                false
            }
            _ if of.is_array() => {
                self.shader.is_es3
                    && types.len() == of.length as usize
                    && types.iter().all(|it| *it == of.element())
            }
            _ => self
                .shader
                .structure(of)
                .is_some_and(|it| it.fields.iter().map(|it| it.of).eq(types.iter().copied())),
        };
        self.require(is_valid, at, "it cannot be constructed from that")?;
        let values = self.operands(&arguments).map(|all| match of.scalar() {
            Some(scalar) => fold::construct(of, scalar, &all),
            None => all.iter().flat_map(|it| it.1).copied().collect(),
        });
        self.add_folded(
            Node::Construct(arguments[..].into()),
            of,
            values,
            &arguments,
        )
    }

    fn call(&mut self, name: Token, arguments: Vec<Id>) -> Result<Id> {
        let signature = (
            name.name,
            arguments.iter().map(|it| self.type_of(*it)).collect(),
        );
        let Some(&function) = self.signatures.get(&signature) else {
            let mut candidates = builtins::functions(
                self.text(name),
                self.shader.stage,
                self.shader.is_es3,
                self.shader.extensions,
            );
            let Some((builtin, of)) =
                candidates.find_map(|it| Some((it, it.result(&signature.1)?)))
            else {
                return self.fail_at(name, "no function with that name takes such arguments");
            };
            return self.call_builtin(name, builtin, of, arguments);
        };
        for (parameter, argument) in self.shader.functions[function as usize]
            .parameters
            .iter()
            .zip(&arguments)
        {
            if let Storage::Parameter(Direction::Out | Direction::InOut) =
                self.shader.variables[*parameter as usize].storage
            {
                self.require_writable(*argument, name)?;
            }
        }
        if let Some(caller) = self.function {
            self.shader.functions[caller as usize].calls.push(function);
        }
        self.add(
            Node::Call(function, arguments[..].into()),
            self.shader.functions[function as usize].returns,
            None,
            &arguments,
        )
    }

    fn call_builtin(
        &mut self,
        name: Token,
        builtin: &'static Builtin,
        of: Type,
        arguments: Vec<Id>,
    ) -> Result<Id> {
        for (role, &argument) in builtin.roles.iter().zip(&arguments) {
            match role {
                Role::Value => {}
                Role::Written => self.require_writable(argument, name)?,
                Role::Offset => {
                    let is_inside = |it: &u32| {
                        (self.limits.texel_offsets[0]..=self.limits.texel_offsets[1])
                            .contains(&(*it as i32))
                    };
                    self.require(
                        self.operand(argument)
                            .is_some_and(|it| it.1.iter().all(is_inside)),
                        name,
                        "the offset is no constant, or is out of range",
                    )?;
                }
                Role::Interpolant => {
                    let whole = if let Node::Index(it, _) = self.at(argument).node
                        && self.type_of(it).is_array()
                    {
                        it
                    } else {
                        argument
                    };
                    let is_input = matches!(self.at(whole).node, Node::Variable(it) if self.shader.variables[it as usize].storage == Storage::Input);
                    self.require(
                        is_input,
                        name,
                        "only an input of the shader can be interpolated",
                    )?;
                }
            }
        }
        let values = self
            .operands(&arguments)
            .and_then(|it| fold::builtin(builtin.name, &it, of));
        self.add_folded(
            Node::Builtin(builtin, arguments[..].into()),
            of,
            values,
            &arguments,
        )
    }
}
