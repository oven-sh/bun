//! Literals.

use std::rc::Rc;

use bun_engine_number::exact_int32;
use bun_engine_syntax::ast::{
    Expr, ExprId, ExprKind, List, Property, PropertyId, PropertyKey, PropertyKind, ScopeId,
    TemplateId,
};
use bun_engine_syntax::{FunctionFlags, Name};
use bun_engine_text::StringRef;

use super::scope::Layout;
use super::{Dest, Generator, LONGEST_ATOM};
use crate::constant::{ArrayLiteral, BigIntLiteral, Constant, RegExpLiteral};
use crate::operand::{ArrayShape, ConstantIndex, DefineFlags, NameListIndex, Operand, Register};
use crate::scope::{ScopeKind, StaticScope};

/// How many values wait in registers for the instruction that takes them all.
const MOST_IN_A_RUN: u32 = 64;

/// The scope that gives methods their home object.
pub(super) struct Home {
    scope: Option<Rc<StaticScope>>,
    register: Register,
}

impl Generator<'_> {
    fn literal_constant(&self, node: &Expr) -> Constant {
        match node.kind {
            ExprKind::Boolean(value) => Constant::Boolean(value),
            ExprKind::Number { value, is_integer } => {
                match exact_int32(value.get()).filter(|_| is_integer) {
                    Some(value) => Constant::Int32(value),
                    None if value.get().is_nan() => Constant::Double(f64::NAN),
                    None => Constant::Double(value.get()),
                }
            }
            ExprKind::String(name) => self.string_constant(name),
            ExprKind::BigInt {
                digits,
                radix,
                is_negative,
            } => Constant::BigInt(Rc::new(BigIntLiteral {
                digits: StringRef::from_text(self.text_of(digits)),
                radix,
                is_negative,
            })),
            _ => Constant::Null,
        }
    }

    #[inline(never)]
    pub(super) fn literal(&mut self, node: &Expr, dst: Dest) -> Operand {
        if dst == Dest::Ignore {
            return self.undefined();
        }
        let value = match node.kind {
            ExprKind::Null => self.null(),
            ExprKind::Boolean(value) => self.boolean(value),
            ExprKind::Number {
                value,
                is_integer: true,
            } => self.number(value.get()),
            ExprKind::Number { value, .. } => self.double(value.get()),
            ExprKind::String(name) => self.string(name),
            _ => {
                let constant = self.literal_constant(node);
                Operand::constant(self.add_constant(constant))
            }
        };
        self.deliver(dst, value)
    }

    /// `method` is what is about to be called on it.
    #[inline(never)]
    pub(super) fn regexp(
        &mut self,
        pattern: Name,
        flags: Name,
        method: Option<Name>,
        dst: Dest,
    ) -> Operand {
        if dst == Dest::Ignore {
            return self.undefined();
        }
        let literal = Constant::RegExp(Rc::new(RegExpLiteral {
            pattern: self.atom(pattern),
            flags: self.atom(flags),
        }));
        let literal = ConstantIndex(self.add_constant(literal));
        let dst = self.final_dst(dst);
        let has_state = (self.text_of(flags).code_units())
            .any(|flag| flag == u16::from(b'g') || flag == u16::from(b'y'));
        match method {
            Some(method @ (Name::TEST | Name::EXEC)) if !has_state => {
                (self.asm()).new_shared_reg_exp(dst, literal, method == Name::TEST);
            }
            _ => self.asm().new_reg_exp(dst, literal),
        }
        dst.into()
    }

    #[inline(never)]
    pub(super) fn template(&mut self, template: TemplateId, dst: Dest) -> Operand {
        let ast = self.ast;
        let template = &ast[template];
        let string = |index| ast.at(template.cooked, index).unwrap_or(Name::EMPTY);
        if template.expressions.is_empty() {
            let value = self.string(string(0));
            return self.deliver(dst, value);
        }
        let mark = self.top;
        for index in 0..template.cooked.len() {
            if self.top - mark >= MOST_IN_A_RUN {
                let (first, count) = (Register::local(mark), self.top - mark);
                self.asm().concatenate(first, first, count);
                self.top = mark + 1;
            }
            if self.name_length(string(index)) != 0 {
                let (register, value) = (self.temp(), self.string(string(index)));
                self.asm().mov(register, value);
            }
            if let Some(expression) = ast.get(template.expressions, index) {
                let register = self.temp();
                let value = self.expr(expression, Dest::Prefer(register));
                self.asm().to_string(register, value);
            }
        }
        let (first, count) = (Register::local(mark), self.top - mark);
        if count == 1 {
            return self.deliver(dst, first);
        }
        self.top = mark;
        let dst = self.final_dst(dst);
        self.asm().concatenate(dst, first, count);
        dst.into()
    }

    // Arrays

    fn shape_of(&self, elements: impl Iterator<Item = Option<ExprId>>) -> ArrayShape {
        let shape = |id: ExprId| match self.ast[id].kind {
            ExprKind::Number { value, .. } if exact_int32(value.get()).is_some() => {
                ArrayShape::Int32
            }
            ExprKind::Number { value, .. } if !value.get().is_nan() => ArrayShape::Double,
            _ if self.is_literal(id) => ArrayShape::Contiguous,
            _ => ArrayShape::Undecided,
        };
        elements
            .flatten()
            .map(shape)
            .max_by_key(|&shape| shape as u8)
            .unwrap_or(ArrayShape::Undecided)
    }

    fn constant_array(&self, elements: List<Option<ExprId>>) -> ArrayLiteral {
        let ast = self.ast;
        let nodes = || ast.iter(elements).flatten().map(|id| &ast[id]);
        let number = |node: &Expr| match node.kind {
            ExprKind::Number { value, .. } => value.get(),
            _ => 0.0,
        };
        let short_string = |node: &Expr| match node.kind {
            ExprKind::String(name) if self.name_length(name) as usize <= LONGEST_ATOM => Some(name),
            _ => None,
        };
        match self.shape_of(ast.iter(elements)) {
            ArrayShape::Int32 => {
                ArrayLiteral::Int32(nodes().map(|node| number(node) as i32).collect())
            }
            ArrayShape::Double => ArrayLiteral::Double(nodes().map(number).collect()),
            _ if nodes().all(|node| short_string(node).is_some()) => ArrayLiteral::Strings(
                (nodes().filter_map(short_string))
                    .map(|name| self.atom(name))
                    .collect(),
            ),
            _ => ArrayLiteral::Values(nodes().map(|node| self.literal_constant(node)).collect()),
        }
    }

    #[inline(never)]
    pub(super) fn array(&mut self, elements: List<Option<ExprId>>, dst: Dest) -> Operand {
        let ast = self.ast;
        if elements.is_empty() {
            let dst = self.final_dst(dst);
            (self.asm()).new_array(dst, Register::SCOPE, 0, ArrayShape::Undecided);
            return dst.into();
        }
        if (ast.iter(elements)).all(|it| it.is_some_and(|it| self.is_literal(it))) {
            let literal = Constant::Array(Rc::new(self.constant_array(elements)));
            let literal = ConstantIndex(self.add_constant(literal));
            let dst = self.final_dst(dst);
            self.asm().new_array_from_constant(dst, literal);
            return dst.into();
        }
        if ast.iter(elements).all(|it| it.is_none()) {
            let length = self.number(f64::from(elements.len()));
            let dst = self.final_dst(dst);
            self.asm().new_array_with_size(dst, length);
            return dst.into();
        }
        if elements.len() <= MOST_IN_A_RUN {
            return self.short_array(elements, elements.len(), dst).into();
        }
        let array = self.temp_dst(dst);
        self.short_array(elements, MOST_IN_A_RUN, Dest::Temp(array));
        let mut rest = elements.skip(MOST_IN_A_RUN);
        while !rest.is_empty() {
            let (mark, count) = (self.top, rest.len().min(MOST_IN_A_RUN));
            let (first, mask) = self.spread_elements(ast.iter(rest).take(count as usize), count);
            self.asm().append_to_array(array, first, count, mask);
            self.top = mark;
            rest = rest.skip(count);
        }
        self.deliver(dst, array)
    }

    /// Of the first `count` elements.
    fn short_array(&mut self, elements: List<Option<ExprId>>, count: u32, dst: Dest) -> Register {
        let (ast, mark) = (self.ast, self.top);
        let elements = ast.iter(elements).take(count as usize);
        let is_spread = |id: ExprId| matches!(ast[id].kind, ExprKind::Spread { .. });
        if elements.clone().flatten().any(is_spread) {
            let (first, mask) = self.spread_elements(elements, count);
            self.top = mark;
            let dst = self.final_dst(dst);
            self.asm().new_array_with_spread(dst, first, count, mask);
            return dst;
        }
        let first = self.run_of_elements(elements.clone(), count);
        self.top = mark;
        let (dst, shape) = (self.final_dst(dst), self.shape_of(elements));
        self.asm().new_array(dst, first, count, shape);
        dst
    }

    // Objects

    fn create_home(&mut self, id: ScopeId) -> Home {
        let (chain, scope) = (self.chain.clone(), self.scope);
        let (register, mut layout) = (self.temp(), Layout::new(ScopeKind::Class));
        for binding in self.ast.bindings(id) {
            self.add_slot(&mut layout, binding);
        }
        self.create_scope(layout, register);
        self.scope = scope;
        self.show_scope(scope);
        Home {
            scope: core::mem::replace(&mut self.chain, chain),
            register,
        }
    }

    fn property_value(&mut self, value: ExprId, home: &mut Option<Home>, dst: Dest) -> Operand {
        if let Some(home) = home
            && let ExprKind::Function(function) = self.ast[value].kind
            && (self.ast[function].flags).contains(FunctionFlags::USES_HOME)
        {
            core::mem::swap(&mut self.chain, &mut home.scope);
            core::mem::swap(&mut self.scope, &mut home.register);
            let result = self.expr(value, dst);
            core::mem::swap(&mut self.chain, &mut home.scope);
            core::mem::swap(&mut self.scope, &mut home.register);
            return result;
        }
        self.expr(value, dst)
    }

    /// The name, if the property is one that `new_object_literal` can define.
    fn plain_name(&self, property: &Property) -> Option<Name> {
        match (property.kind, property.key) {
            (PropertyKind::Value, PropertyKey::Named(name)) if self.array_index(name).is_none() => {
                Some(name)
            }
            _ => None,
        }
    }

    /// How many properties from the first on are plain and have distinct names.
    fn plain_prefix(&self, properties: List<PropertyId>) -> u32 {
        let ast = self.ast;
        let mut count = 0;
        for property in ast.iter(properties).take(MOST_IN_A_RUN as usize) {
            let Some(name) = self.plain_name(&ast[property]) else {
                break;
            };
            let mut earlier = ast.iter(properties).take(count);
            if earlier.any(|it| ast[it].key == PropertyKey::Named(name)) {
                break;
            }
            count += 1;
        }
        count as u32
    }

    pub(super) fn add_name_list(&mut self, names: impl Iterator<Item = Name>) -> NameListIndex {
        let list = names.map(|name| self.make_identifier(name)).collect();
        self.b.name_lists.push(list);
        NameListIndex(self.b.name_lists.len() as u32 - 1)
    }

    #[inline(never)]
    pub(super) fn object(
        &mut self,
        start: u32,
        properties: List<PropertyId>,
        home: Option<ScopeId>,
        dst: Dest,
    ) -> Operand {
        let ast = self.ast;
        if properties.is_empty() {
            if dst == Dest::Ignore {
                return self.undefined();
            }
            let dst = self.final_dst(dst);
            self.asm().new_object(dst, 0);
            return dst.into();
        }
        let plain = self.plain_prefix(properties);
        let is_done_at_once = plain == properties.len() && home.is_none();
        let early = (!is_done_at_once).then(|| self.temp_dst(dst));
        let mut home = home.map(|home| self.create_home(home));
        let mark = self.top;
        let capacity = (ast.iter(properties))
            .filter(|&it| matches!(ast[it].key, PropertyKey::Named(_)))
            .count()
            .min(super::MOST_CAPACITY as usize) as u32;
        let first = &ast[ast.at(properties, 0)];
        let (object, defined);
        if plain > 0 {
            let values = self.temps(plain);
            let prefix = ast.iter(properties).take(plain as usize);
            for (index, property) in (0..).zip(prefix.clone()) {
                let dst = Dest::Temp(values.nth(index));
                self.property_value(ast[property].value, &mut home, dst);
            }
            let names = prefix.filter_map(|it| match ast[it].key {
                PropertyKey::Named(name) => Some(name),
                _ => None,
            });
            let names = self.add_name_list(names);
            self.top = mark;
            object = early.unwrap_or_else(|| self.final_dst(dst));
            (self.asm()).new_object_literal(object, names, values, plain, capacity);
            defined = plain;
        } else if let ExprKind::Spread { value, .. } = ast[first.value].kind {
            object = early.unwrap_or_else(|| self.final_dst(dst));
            let source = self.expr(value, Dest::Prefer(object));
            self.position_at(start);
            self.asm().clone_object(object, source);
            defined = 1;
        } else {
            object = early.unwrap_or_else(|| self.final_dst(dst));
            self.asm().new_object(object, capacity);
            defined = 0;
        }
        if let Some(home) = &home {
            self.asm().put_scoped(home.register, 0, object);
        }
        let mut rest = properties.skip(defined);
        while !rest.is_empty() {
            self.top = self.top.max(mark);
            let mark = self.top;
            rest = rest.skip(self.define_property(object, start, rest, &mut home));
            self.top = mark;
        }
        self.deliver(dst, object)
    }

    pub(super) fn is_anonymous_function(&self, value: ExprId) -> bool {
        match self.ast[value].kind {
            ExprKind::Function(function) => self.ast[function].name.is_none(),
            ExprKind::Class(class) => self.ast[class].name.is_none(),
            _ => false,
        }
    }

    /// NamedEvaluation, with a name that is known only at run time.
    pub(super) fn named_value(&mut self, value: ExprId, name: Operand, dst: Dest) -> Operand {
        let node = &self.ast[value];
        if let ExprKind::Class(class) = node.kind {
            self.pause_before(node);
            return self.class(node.start, class, Some(name), dst);
        }
        let function = self.expr(value, dst);
        self.name_function(function, name);
        function
    }

    fn name_function(&mut self, function: Operand, name: Operand) {
        let function = self.in_register(function);
        self.asm().set_function_name(function, name);
    }

    pub(super) fn property_key(&mut self, key: PropertyKey) -> Operand {
        match key {
            PropertyKey::Named(name) | PropertyKey::Private(name) => self.key_constant(name),
            PropertyKey::Computed(key) => {
                let register = self.temp();
                let value = self.expr(key, Dest::Prefer(register));
                self.asm().to_property_key(register, value);
                register.into()
            }
            PropertyKey::None => self.undefined(),
        }
    }

    /// The flags for an accessor, and for the one after it if the two make a pair.
    pub(super) fn accessor_flags(
        is_getter: bool,
        is_paired: bool,
        key: PropertyKey,
    ) -> DefineFlags {
        let mut flags = DefineFlags::empty();
        flags.set(DefineFlags::HAS_GETTER, is_getter || is_paired);
        flags.set(DefineFlags::HAS_SETTER, !is_getter || is_paired);
        flags.set(
            DefineFlags::SET_NAME,
            matches!(key, PropertyKey::Computed(_)),
        );
        flags
    }

    /// Defines the first of `properties`, and returns how many it has dealt with.
    fn define_property(
        &mut self,
        object: Register,
        start: u32,
        properties: List<PropertyId>,
        home: &mut Option<Home>,
    ) -> u32 {
        let ast = self.ast;
        let property = &ast[ast.at(properties, 0)];
        match (property.kind, property.key) {
            (PropertyKind::Spread, _) => {
                let node = &ast[property.value];
                if let ExprKind::Spread { value, divot, end } = node.kind {
                    let source = self.expr(value, Dest::Any);
                    self.position(divot, node.start, end);
                    self.asm().copy_data_properties(object, source);
                }
            }
            (PropertyKind::Prototype, _) => {
                let prototype = self.expr(property.value, Dest::Any);
                self.position_at(start);
                self.asm().set_prototype(object, prototype);
            }
            (PropertyKind::Getter | PropertyKind::Setter, key) => {
                let is_getter = property.kind == PropertyKind::Getter;
                let partner = ast.get(properties, 1).map(|it| &ast[it]).filter(|it| {
                    matches!(it.kind, PropertyKind::Getter | PropertyKind::Setter)
                        && it.kind != property.kind
                        && it.key == key
                });
                let name = self.property_key(key);
                let first = self.property_value(property.value, home, Dest::Any);
                let second = match partner {
                    Some(partner) => self.property_value(partner.value, home, Dest::Any),
                    None => self.undefined(),
                };
                let (getter, setter) = if is_getter {
                    (first, second)
                } else {
                    (second, first)
                };
                let flags = Self::accessor_flags(is_getter, partner.is_some(), key);
                let flags = flags | DefineFlags::ENUMERABLE;
                (self.asm()).define_accessor(object, name, getter, setter, flags);
                return 1 + u32::from(partner.is_some());
            }
            (PropertyKind::Value, PropertyKey::Computed(key)) => {
                let is_anonymous = self.is_anonymous_function(property.value);
                let key = if is_anonymous || !self.is_literal(property.value) {
                    self.converted_key(key, is_anonymous)
                } else {
                    self.key_expr(key, false)
                };
                let value = match ast[property.value].kind {
                    ExprKind::Class(_) if is_anonymous => {
                        self.named_value(property.value, key, Dest::Any)
                    }
                    _ => {
                        let value = self.property_value(property.value, home, Dest::Any);
                        if is_anonymous {
                            self.name_function(value, key);
                        }
                        value
                    }
                };
                let strict = self.is_strict;
                self.asm().put_by_val_direct(object, key, value, strict);
            }
            (PropertyKind::Value, key) => {
                let value = self.property_value(property.value, home, Dest::Any);
                match self.plain_name(property) {
                    Some(name) => self.put_by_id(object.into(), name, value, true),
                    None => {
                        let (key, strict) = (self.property_key(key), self.is_strict);
                        self.asm().put_by_val_direct(object, key, value, strict);
                    }
                }
            }
        }
        1
    }

    /// A computed key, converted before what follows is evaluated.
    pub(super) fn converted_key(&mut self, key: ExprId, names_function: bool) -> Operand {
        if names_function {
            return self.property_key(PropertyKey::Computed(key));
        }
        if let ExprKind::String(_) | ExprKind::Number { .. } = self.ast[key].kind {
            return self.key_expr(key, false);
        }
        let register = self.temp();
        let value = self.expr(key, Dest::Prefer(register));
        self.asm().to_property_key_or_number(register, value);
        register.into()
    }
}
