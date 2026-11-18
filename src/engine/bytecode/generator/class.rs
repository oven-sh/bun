//! Classes.

use bun_engine_syntax::ast::{
    Binding, BindingFlags, Class, ClassElement, ClassElementKind, ClassId, ExprId, FunctionId,
    PropertyKey, ScopeId, Stmt,
};
use bun_engine_syntax::{EvalContext, FieldKind, FieldSource, FunctionFlags, FunctionKind, Name};

use super::scope::{Layout, Place};
use super::{Dest, Generator};
use crate::function::{Fields, Visibility};
use crate::operand::{DefineFlags, Operand, Register, StaticError};
use crate::scope::{ScopeKind, SlotKind};

#[derive(Default)]
struct FieldList {
    sources: Vec<FieldSource>,
    key_slots: Vec<u32>,
}

fn is_computed_field(element: &ClassElement) -> bool {
    matches!(
        (element.kind, element.key),
        (ClassElementKind::Field(_), PropertyKey::Computed(_))
    )
}

impl<'a> Generator<'a> {
    fn bindings_of(&self, scope: Option<ScopeId>) -> &'a [Binding] {
        scope.map_or(&[], |scope| self.ast.bindings(scope))
    }

    /// Returns the first of the slots for computed keys.
    fn enter_class_scope(
        &mut self,
        start: u32,
        head: Option<ScopeId>,
        body: Option<ScopeId>,
        computed_keys: u32,
    ) -> u32 {
        let first_binding = self.b.bindings.len();
        let (register, mut layout) = (self.temp(), Layout::new(ScopeKind::Class));
        for binding in self.bindings_of(head) {
            if binding.flags.contains(BindingFlags::CAPTURED) {
                let slot = self.add_slot(&mut layout, binding);
                // No method runs before the name is bound. Closures that may are created at `start`.
                layout.set_detail_of_last(start + 1);
                self.bind_slot(binding, register, slot);
            } else {
                self.bind_register(binding);
            }
        }
        for binding in self.bindings_of(body) {
            let slot = self.add_slot(&mut layout, binding);
            self.bind_slot(binding, register, slot);
        }
        let mut first_key_slot = 0;
        for index in 0..computed_keys {
            let slot = layout.anonymous_slot();
            first_key_slot = slot - index;
        }
        if !layout.is_empty() {
            self.create_scope(layout, register);
            self.describe_private_names(first_binding);
        }
        first_key_slot
    }

    /// An expression that runs while the class is being defined.
    fn during_definition<T>(&mut self, start: u32, evaluate: impl FnOnce(&mut Self) -> T) -> T {
        let outer = self.closure_position;
        self.closure_position = Some(outer.unwrap_or(start));
        let result = evaluate(self);
        self.closure_position = outer;
        result
    }

    /// The slot of a name of the engine, if this very class binds it.
    fn class_internal(&mut self, class: &Class, name: Name) -> Option<Place> {
        let bindings = self.bindings_of(class.body_scope);
        bindings.iter().rev().find(|it| it.name == name)?;
        self.own_internal(name)
    }

    fn put_class_internal(&mut self, class: &Class, name: Name, value: Register) {
        if let Some(place) = self.class_internal(class, name) {
            self.put(place, name, None, value.into());
        }
    }

    /// `name` is the name of an anonymous class, where that is computed.
    #[inline(never)]
    pub(super) fn class(
        &mut self,
        start: u32,
        id: ClassId,
        name: Option<Operand>,
        dst: Dest,
    ) -> Operand {
        let ast = self.ast;
        let class = &ast[id];
        let elements = || ast.iter(class.elements).map(|it| &ast[it]);
        let constructor = self.temp_dst(dst);
        let was_strict = core::mem::replace(&mut self.is_strict, true);
        self.open_scope();
        let computed_keys = elements().filter(|it| is_computed_field(it)).count() as u32;
        let evaluate_heritage = |generator: &mut Self| match class.heritage {
            Some(heritage) => {
                generator.during_definition(start, |it| it.stable_expr(heritage, false))
            }
            None => generator.empty(),
        };
        let (heritage, mut key_slot);
        if class.heritage_sees_private_names || self.debugs {
            self.enter_class_scope(start, class.head_scope, None, 0);
            heritage = evaluate_heritage(self);
            key_slot = self.enter_class_scope(start, None, class.body_scope, computed_keys);
        } else {
            let (head, body) = (class.head_scope, class.body_scope);
            key_slot = self.enter_class_scope(start, head, body, computed_keys);
            heritage = evaluate_heritage(self);
        }

        let (prototype, scratch) = (self.temp(), self.temp());
        let brand = self.class_internal(class, Name::CLASS_BRAND);
        if let Some(place) = brand {
            let description = self.identifier(Name::EMPTY);
            self.asm().create_private_name(scratch, description);
            self.put(place, Name::CLASS_BRAND, None, scratch.into());
        }
        for element in elements() {
            if let (ClassElementKind::Field(_), PropertyKey::Private(name)) =
                (element.kind, element.key)
            {
                let description = self.identifier(name);
                self.asm().create_private_name(scratch, description);
                self.initialize(name, scratch.into());
            }
        }

        let function = self.add_constructor(start, class);
        let name = name.unwrap_or_else(|| self.empty());
        let scope = self.scope;
        if class.heritage.is_some() {
            self.position(class.divot, start, class.head_end);
        }
        (self.asm()).new_class(constructor, prototype, scope, function, heritage, name);
        self.position_at(start);
        self.put_class_internal(class, Name::CLASS_HOME, prototype);
        self.put_class_internal(class, Name::CLASS_STATIC_HOME, constructor);

        let (mut instance, mut statics) = (FieldList::default(), FieldList::default());
        let first_start = elements().next().map_or(start, |first| first.start);
        let mut rest = class.elements;
        while let Some(element) = ast.get(rest, 0) {
            let (element, mark) = (&ast[element], self.top);
            rest = rest.skip(1);
            let object = if element.is_static {
                constructor
            } else {
                prototype
            };
            match element.kind {
                ClassElementKind::Method(function) => {
                    self.define_method(start, first_start, object, element, function);
                }
                ClassElementKind::Getter(function) | ClassElementKind::Setter(function) => {
                    let next = ast.get(rest, 0).map(|it| &ast[it]);
                    if self.define_accessor(start, object, element, function, next) {
                        rest = rest.skip(1);
                    }
                }
                ClassElementKind::Field(_) | ClassElementKind::StaticBlock => {
                    let list = if element.is_static {
                        &mut statics
                    } else {
                        &mut instance
                    };
                    self.collect_field(start, element, list, &mut key_slot);
                }
            }
            self.top = mark;
        }

        if let Some(place) = self.class_internal(class, Name::CLASS_FIELD_INITIALIZER) {
            self.new_field_initializer(scratch, start, class, instance, brand.is_some(), false);
            self.put(place, Name::CLASS_FIELD_INITIALIZER, None, scratch.into());
        }
        for binding in self.bindings_of(class.head_scope) {
            if binding.flags.contains(BindingFlags::USED) {
                self.initialize(binding.name, constructor.into());
            }
        }
        if !statics.sources.is_empty() {
            self.new_field_initializer(scratch, start, class, statics, false, true);
            self.position_at(start);
            self.call_method(scratch, scratch, constructor.into(), None);
        }
        self.close_scope();
        self.is_strict = was_strict;
        self.deliver(dst, constructor)
    }

    fn add_constructor(&mut self, start: u32, class: &Class) -> crate::operand::FunctionIndex {
        let ast = self.ast;
        let mut info = match class.constructor {
            Some(constructor) => self.function_info(&ast[constructor], start + 1),
            None => {
                let kind = match class.heritage {
                    Some(_) => FunctionKind::DerivedConstructor,
                    None => FunctionKind::BaseConstructor,
                };
                let mut info = self.synthetic_function_info(kind, start + 1);
                info.origin = info.origin.of_default_constructor();
                info.visibility = Visibility::Public;
                info.parameters_start = "(function ".len() as u32;
                info
            }
        };
        info.name = self.function_name_of(class.name);
        info.has_own_name = class.own_name.is_some();
        info.text = start..class.end;
        if (self.class_internal(class, Name::CLASS_FIELD_INITIALIZER)).is_some() {
            info.context |= EvalContext::HAS_FIELD_INITIALIZER;
        }
        for element in ast.iter(class.elements).map(|it| &ast[it]) {
            if let (ClassElementKind::Field(initializer), false) = (element.kind, element.is_static)
            {
                let is_bare = initializer.is_none() && matches!(element.key, PropertyKey::Named(_));
                info.instance_fields = info.instance_fields.saturating_add(1);
                info.bare_fields = info.bare_fields.saturating_add(is_bare.into());
            }
        }
        self.add_function(info)
    }

    fn element_key(&mut self, class_start: u32, key: PropertyKey) -> Operand {
        self.during_definition(class_start, |generator| generator.property_key(key))
    }

    fn define_method(
        &mut self,
        class_start: u32,
        position: u32,
        object: Register,
        element: &ClassElement,
        function: FunctionId,
    ) {
        if let PropertyKey::Private(name) = element.key {
            let method = self.temp();
            self.new_function(method, function, element.start);
            return self.initialize(name, method.into());
        }
        if let PropertyKey::Named(name) = element.key
            && self.ast.names.kind(name) != bun_engine_syntax::NameKind::Ordinary
        {
            let method = self.temp();
            self.new_function(method, function, element.start);
            return self.put_by_id(object.into(), name, method.into(), true);
        }
        let key = self.element_key(class_start, element.key);
        let method = self.temp();
        self.new_function(method, function, element.start);
        let mut flags = DefineFlags::empty();
        flags.set(
            DefineFlags::SET_NAME,
            matches!(element.key, PropertyKey::Computed(_)),
        );
        self.position_at(position);
        self.asm().define_method(object, key, method, flags);
    }

    /// Returns whether it has defined `next` as well.
    fn define_accessor(
        &mut self,
        class_start: u32,
        object: Register,
        element: &ClassElement,
        function: FunctionId,
        next: Option<&ClassElement>,
    ) -> bool {
        let is_getter = matches!(element.kind, ClassElementKind::Getter(_));
        if let PropertyKey::Private(name) = element.key {
            let accessor = self.temp();
            self.new_function(accessor, function, element.start);
            if let Place::Slot { scope, slot, .. } = self.resolve_declared(name) {
                (self.asm()).put_scoped(scope, slot + u32::from(!is_getter), accessor);
            }
            return false;
        }
        let partner =
            next.filter(|next| next.key == element.key && next.is_static == element.is_static)
                .and_then(|next| match (next.kind, is_getter) {
                    (ClassElementKind::Setter(it), true)
                    | (ClassElementKind::Getter(it), false) => Some((it, next.start)),
                    _ => None,
                });
        let key = self.element_key(class_start, element.key);
        let first = self.temp();
        self.new_function(first, function, element.start);
        let second = match partner {
            Some((partner, start)) => {
                let second = self.temp();
                self.new_function(second, partner, start);
                second.into()
            }
            None => self.undefined(),
        };
        let (getter, setter) = if is_getter {
            (first.into(), second)
        } else {
            (second, first.into())
        };
        let flags = Self::accessor_flags(is_getter, partner.is_some(), element.key);
        (self.asm()).define_accessor(object, key, getter, setter, flags);
        partner.is_some()
    }

    fn collect_field(
        &mut self,
        class_start: u32,
        element: &ClassElement,
        list: &mut FieldList,
        next_key_slot: &mut u32,
    ) {
        let initializer = match element.kind {
            ClassElementKind::Field(initializer) => initializer,
            _ => None,
        };
        let mut key_slot = 0;
        let kind = match (element.kind, element.key) {
            (ClassElementKind::StaticBlock, _) => FieldKind::StaticBlock,
            (_, PropertyKey::Private(_)) => FieldKind::Private,
            (_, PropertyKey::Computed(_)) => {
                let key = self.element_key(class_start, element.key);
                if element.is_static {
                    let (prototype, valid) = (self.string(Name::PROTOTYPE), self.asm().label());
                    self.asm().jump_if_strict_not_equal(prototype, key, valid);
                    self.throw_static(StaticError::StaticFieldNamedPrototype);
                    self.asm().bind(valid);
                }
                key_slot = *next_key_slot;
                *next_key_slot += 1;
                let scope = self.scope;
                self.asm().put_scoped(scope, key_slot, key);
                FieldKind::Computed
            }
            _ => FieldKind::Named,
        };
        list.sources.push(FieldSource {
            kind,
            start: element.start,
            key_start: element.key_start,
            initializer_start: initializer.map_or(0, |it| it.start),
        });
        list.key_slots.push(key_slot);
        if let Some(initializer) = initializer.filter(|_| self.covers) {
            let start = match kind {
                FieldKind::Computed => initializer.start - 1,
                _ => element.start,
            };
            self.declare_coverage_block(start, initializer.end);
        }
    }

    fn new_field_initializer(
        &mut self,
        dst: Register,
        start: u32,
        class: &Class,
        list: FieldList,
        sets_brand: bool,
        is_static: bool,
    ) {
        let mut info = self.synthetic_function_info(FunctionKind::FieldInitializer, start + 1);
        let home = match is_static {
            true => Name::CLASS_STATIC_HOME,
            false => Name::CLASS_HOME,
        };
        info.flags.set(FunctionFlags::STATIC, is_static);
        (info.flags).set(
            FunctionFlags::USES_HOME,
            self.class_internal(class, home).is_some(),
        );
        info.visibility = info.visibility.max(Visibility::Private);
        (info.start, info.parameters_start, info.end) = (start, start, class.end);
        info.text = start..class.end;
        info.created_at = self.creation_position(list.sources.first().map_or(start, |it| it.start));
        info.fields = Some(Box::new(Fields {
            sources: list.sources.into(),
            key_slots: list.key_slots.into(),
            sets_brand,
        }));
        let (function, scope) = (self.add_function(info), self.scope);
        self.asm().new_function(dst, scope, function);
    }

    // The body of a field initializer

    pub(super) fn only_sets_brand(&self) -> bool {
        self.function_kind == FunctionKind::FieldInitializer && self.tree.body.is_empty()
    }

    pub(super) fn set_brand(&mut self) {
        let (mark, brand) = (self.top, self.temp());
        self.load_outer_internal(Name::CLASS_BRAND, brand);
        self.asm().set_private_brand(Register::THIS, brand);
        self.top = mark;
    }

    #[inline(never)]
    pub(super) fn define_field(
        &mut self,
        start: u32,
        index: u32,
        key: PropertyKey,
        value: Option<ExprId>,
    ) {
        let this = Register::THIS;
        let is_computed = !matches!(key, PropertyKey::Named(_) | PropertyKey::Private(_));
        let computed_key = is_computed.then(|| {
            let fields = self.function.and_then(|it| it.fields.as_deref());
            let slot = fields.and_then(|it| it.key_slots.get(index as usize));
            let (slot, key) = (slot.copied().unwrap_or(0), self.temp());
            self.asm().get_internal(key, Register::SCOPE, 0, slot);
            Operand::from(key)
        });
        let value = match value {
            None => self.undefined(),
            Some(value) => {
                let fields = self.function.and_then(|it| it.fields.as_deref());
                let source = fields.and_then(|it| it.sources.get(index as usize));
                let start = match source {
                    Some(source) if is_computed => source.initializer_start - 1,
                    _ => start,
                };
                self.cover(start, self.ast[value].end);
                match computed_key {
                    Some(name) if self.is_anonymous_function(value) => {
                        self.named_value(value, name, Dest::Any)
                    }
                    _ => self.expr(value, Dest::Any),
                }
            }
        };
        match (key, computed_key) {
            (_, Some(key)) => {
                self.position(start, start, start + 1);
                self.asm().put_by_val_direct(this, key, value, true);
            }
            (PropertyKey::Private(name), _) => {
                self.position(start, start, start + self.name_length(name));
                if let Some((place, private)) = self.resolve_private(name)
                    && private.kind == SlotKind::PrivateField
                {
                    let symbol = self.temp();
                    self.load_internal(place, symbol);
                    self.asm().define_private_name(this, symbol, value);
                }
            }
            (PropertyKey::Named(name), _) if self.array_index(name).is_none() => {
                self.put_by_id(this.into(), name, value, true);
            }
            _ => {
                let key = self.property_key(key);
                self.asm().put_by_val_direct(this, key, value, true);
            }
        }
    }

    #[inline(never)]
    pub(super) fn run_static_block(&mut self, node: &Stmt, function: FunctionId) {
        let block = self.temp();
        let mut info = self.function_info(&self.ast[function], node.start);
        if !self.context.contains(EvalContext::IN_METHOD) {
            info.flags -= FunctionFlags::USES_HOME;
        }
        let (function, scope) = (self.add_function(info), self.scope);
        self.asm().new_function(block, scope, function);
        self.debug_hook(crate::operand::DebugHook::WillExecuteExpression, node.start);
        self.position(node.end, node.start, node.end);
        self.call_method(block, block, Register::THIS.into(), None);
    }
}
