//! Destructuring.

use bun_engine_syntax::ast::{
    DeclarationKind, ExprId, List, Pattern, PatternElement, PatternElementId, PatternId,
    PatternKind, PropertyKey,
};

use bun_engine_syntax::{Name, NameKind};

use super::control::Closer;
use super::reference::Reference;
use super::scope::Place;
use super::{Dest, Generator};
use crate::operand::{CloseMode, DebugHook, Operand, Register, StaticError};

/// Where a value goes, with all that has to be evaluated before the value is known.
#[derive(Clone, Copy)]
pub(super) enum Target {
    Lexical(Name, DeclarationKind),
    Reference(Reference),
    Pattern,
}

fn range(pattern: &Pattern) -> (u32, u32, u32) {
    (pattern.end, pattern.start, pattern.end)
}

impl Generator<'_> {
    #[inline(never)]
    pub(super) fn destructure(&mut self, pattern: PatternId, value: ExprId, dst: Dest) -> Operand {
        if dst == Dest::Ignore {
            let is_at_risk = self
                .register_of(value)
                .is_none_or(|it| self.may_clobber(pattern, it));
            let source = self.stable_expr(value, is_at_risk);
            self.bind_pattern(pattern, source);
            return source;
        }
        let source = self.temp_dst(dst);
        self.expr(value, Dest::Temp(source));
        self.bind_pattern(pattern, source.into());
        self.deliver(dst, source)
    }

    /// Whether the variable in `register` may change while the pattern still has to read it.
    fn may_clobber(&mut self, pattern: PatternId, register: Register) -> bool {
        let ast = self.ast;
        let PatternKind::Object(elements) = ast[pattern].kind else {
            return false;
        };
        ast.iter(elements).map(|it| &ast[it]).any(|element| {
            let is_other_variable = element.pattern.is_some_and(|it| match ast[it].kind {
                PatternKind::Binding { name, .. } => {
                    self.resolve(name, ast[it].start).register() != Some(register)
                }
                _ => false,
            });
            !is_other_variable
                || matches!(element.key, PropertyKey::Computed(key) if self.may_assign(key))
                || element.default.is_some_and(|it| self.may_assign(it))
        })
    }

    pub(super) fn target(&mut self, pattern: PatternId) -> Target {
        let pattern = &self.ast[pattern];
        match pattern.kind {
            PatternKind::Binding {
                name,
                declaration: None | Some(DeclarationKind::Var),
            } => Target::Reference(self.variable_reference(name, pattern.start, range(pattern))),
            PatternKind::Binding {
                name,
                declaration: Some(kind),
            } => Target::Lexical(name, kind),
            PatternKind::Target(target) => {
                let reference = self.reference(target, range(pattern));
                if let Reference::Member(_) = reference {
                    self.position(pattern.end, pattern.start, pattern.end);
                }
                Target::Reference(reference)
            }
            PatternKind::Array(_) | PatternKind::Object(_) => Target::Pattern,
        }
    }

    /// The register that the value can go straight into.
    pub(super) fn direct_register(&mut self, target: &Target) -> Option<Register> {
        match *target {
            Target::Lexical(name, DeclarationKind::Let | DeclarationKind::Const) => {
                match self.resolve_declared(name) {
                    Place::Register(register) => Some(register),
                    _ => None,
                }
            }
            Target::Reference(Reference::Variable(variable, _)) => variable.writable_register(),
            _ => None,
        }
    }

    /// The same for a pattern that is a name, without evaluating anything.
    pub(super) fn resolve_pattern_register(&mut self, pattern: PatternId) -> Option<Register> {
        let node = &self.ast[pattern];
        match node.kind {
            PatternKind::Binding {
                name,
                declaration: None | Some(DeclarationKind::Var),
            } => self.resolve(name, node.start).writable_register(),
            PatternKind::Binding {
                name,
                declaration: Some(kind),
            } => self.direct_register(&Target::Lexical(name, kind)),
            _ => None,
        }
    }

    pub(super) fn assign_target(&mut self, pattern: PatternId, target: &Target, value: Operand) {
        let node = &self.ast[pattern];
        match target {
            &Target::Lexical(name, kind) => {
                if self.resolve_declared(name) == Place::Global {
                    self.position(node.end, node.start, node.end);
                }
                self.initialize(name, value);
                if let DeclarationKind::Using | DeclarationKind::AwaitUsing = kind {
                    self.add_disposable(value, node.start, kind == DeclarationKind::AwaitUsing);
                }
            }
            Target::Reference(Reference::Member(member)) => {
                self.put_member(node.start, member, value);
            }
            Target::Reference(reference) => self.store_reference(reference, value, range(node)),
            Target::Pattern => self.bind_pattern(pattern, value),
        }
    }

    /// `value` is no variable that the pattern may assign to.
    pub(super) fn bind_pattern(&mut self, pattern: PatternId, value: Operand) {
        if !self.can_recurse() {
            return;
        }
        let (node, mark) = (&self.ast[pattern], self.top);
        match node.kind {
            PatternKind::Array(elements) => self.bind_array(node, elements, value),
            PatternKind::Object(elements) => self.bind_object(node, elements, value),
            _ => {
                let target = self.target(pattern);
                self.assign_target(pattern, &target, value);
            }
        }
        self.top = mark;
    }

    pub(super) fn apply_default(&mut self, value: Register, default: ExprId) {
        let (present, undefined) = (self.asm().label(), self.undefined());
        self.asm().jump_if_not_identical(value, undefined, present);
        self.cover_skippable(default, self.ast[default].end);
        self.expr(default, Dest::Temp(value));
        self.asm().bind(present);
    }

    /// Where to put the value of an element: the variable itself if nothing can see it half done.
    fn element_register(&mut self, element: &PatternElement, target: &Target) -> Register {
        match self.direct_register(target) {
            Some(register) if element.default.is_none_or(|it| self.is_literal(it)) => register,
            _ => self.temp(),
        }
    }

    fn finish_element(
        &mut self,
        element: &PatternElement,
        pattern: PatternId,
        target: &Target,
        value: Register,
    ) {
        if let Some(default) = element.default {
            self.apply_default(value, default);
        }
        self.assign_target(pattern, target, value.into());
    }

    #[inline(never)]
    fn bind_array(&mut self, node: &Pattern, elements: List<PatternElementId>, value: Operand) {
        let ast = self.ast;
        let state = self.temps(3);
        self.debug_hook(DebugHook::WillExecuteExpression, node.start);
        self.position(node.start, node.start, node.end);
        self.asm().iterator_begin(state, value);
        let try_depth = self.asm().try_depth();
        let handler = self.guard_iterator(Closer::State(state), (node.start, node.start, node.end));
        let mut is_exhausted = false;
        for element in ast.iter(elements) {
            let (element, mark) = (&ast[element], self.top);
            let target = element
                .pattern
                .map(|pattern| (pattern, self.target(pattern)));
            let value = target.map(|(_, target)| self.element_register(element, &target));
            self.debug_hook(DebugHook::WillExecuteExpression, node.start);
            // An iterator that throws is not closed.
            let suspended = self.asm().suspend_tries(try_depth);
            self.position(node.start, node.start, node.end);
            match value {
                None => self.asm().iterator_skip(state),
                Some(value) if element.is_rest => self.asm().iterator_rest(value, state),
                Some(value) => self.asm().iterator_step(value, state),
            }
            self.asm().resume_tries(suspended);
            if let (Some((pattern, target)), Some(value)) = (target, value) {
                self.finish_element(element, pattern, &target, value);
            }
            is_exhausted = element.is_rest;
            self.top = mark;
        }
        self.asm().pop_try();
        if !is_exhausted {
            self.position(node.start, node.start, node.end);
            self.asm().iterator_close(state, CloseMode::Normal);
        }
        if !self.asm().is_referenced(handler) {
            return self.close_iterator_on_exits();
        }
        let done = self.asm().label();
        self.asm().jump(done);
        self.close_iterator_on_exits();
        self.close_iterator_on_throw(handler, state);
        self.asm().bind(done);
    }

    #[inline(never)]
    fn bind_object(&mut self, node: &Pattern, elements: List<PatternElementId>, value: Operand) {
        let ast = self.ast;
        let first_name = match ast.get(elements, 0).map(|first| ast[first].key) {
            Some(PropertyKey::Named(name)) if ast.names.kind(name) == NameKind::Ordinary => name,
            _ => Name::EMPTY,
        };
        self.throw_if_nullish(value, StaticError::DestructureNullish, first_name);
        let has_rest = ast
            .iter(elements)
            .next_back()
            .is_some_and(|it| ast[it].is_rest);
        let is_computed = |&it: &PatternElementId| matches!(ast[it].key, PropertyKey::Computed(_));
        let computed_count = if has_rest {
            ast.iter(elements).filter(is_computed).count() as u32
        } else {
            0
        };
        let (computed_keys, mut saved) = (self.temps(computed_count), 0);
        for element in ast.iter(elements) {
            let (element, mark) = (&ast[element], self.top);
            let Some(pattern) = element.pattern else {
                continue;
            };
            let key = match element.key {
                PropertyKey::Computed(key) => Some(self.converted_key(key, false)),
                PropertyKey::Named(name) if self.array_index(name).is_some() => {
                    Some(self.key_constant(name))
                }
                _ => None,
            };
            if let (true, PropertyKey::Computed(_), Some(key)) = (has_rest, element.key, key) {
                self.asm().mov(computed_keys.nth(saved), key);
                saved += 1;
            }
            let target = self.target(pattern);
            let register = self.element_register(element, &target);
            match (key, element.key) {
                (Some(key), _) => self.get_by_val(register, value, key),
                (None, PropertyKey::Named(name)) => self.get_by_id(register, value, name),
                (None, _) => {
                    let names = ast.iter(elements).filter_map(|it| match ast[it].key {
                        PropertyKey::Named(name) => Some(name),
                        _ => None,
                    });
                    let excluded = self.add_name_list(names);
                    let first = if saved == 0 {
                        Register::SCOPE
                    } else {
                        computed_keys
                    };
                    self.position(node.start, node.start, node.end);
                    self.asm()
                        .copy_rest(register, value, excluded, first, saved);
                }
            }
            self.finish_element(element, pattern, &target, register);
            self.top = mark;
        }
    }

    /// The rest parameter.
    pub(super) fn bind_rest(&mut self, pattern: PatternId, skip: u32) {
        let mark = self.top;
        let target = self.target(pattern);
        let array = self.direct_register(&target).unwrap_or_else(|| self.temp());
        self.asm().create_rest(array, skip);
        self.assign_target(pattern, &target, array.into());
        self.top = mark;
    }
}
