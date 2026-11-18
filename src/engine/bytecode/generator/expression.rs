//! The dispatch over expressions, and those that take few lines.

use bun_engine_syntax::ast::{DeclarationKind, Expr, ExprFlags, ExprId, ExprKind, List};
use bun_engine_syntax::{EvalContext, FunctionFlags, FunctionKind, Name};

use super::function::{Arguments, Lazy};
use super::intrinsic::Builtin;
use super::scope::{Place, Variable};
use super::{Dest, Generator, Tail, This};
use crate::code::CodeKind;
use crate::operand::{DebugHook, ImportPhase, Operand, Register, StaticError, Unresolved};
use crate::scope::{SlotFlags, SlotKind};

/// Below so many expressions, a chain of operators is taken from its far end and needs no stack.
const SHALLOW: u32 = 64;

impl Generator<'_> {
    /// Leaves allocated only the register with the value, if it took one.
    #[inline]
    pub(super) fn expr(&mut self, id: ExprId, dst: Dest) -> Operand {
        self.expr_in(id, dst, Tail::No)
    }

    pub(super) fn expr_in(&mut self, id: ExprId, dst: Dest, tail: Tail) -> Operand {
        if !self.can_recurse() {
            return self.undefined();
        }
        let node = &self.ast[id];
        self.pause_before(node);
        let mark = self.top;
        if self.depth >= SHALLOW
            && let Some(value) = self.evaluate_first_operands(id)
        {
            return self.deliver(dst, value);
        }
        self.depth += 1;
        let value = self.dispatch(node, dst, tail);
        self.depth -= 1;
        debug_assert!(self.evaluated.is_none() || self.failure.is_some());
        match value.as_register().and_then(Register::local_index) {
            Some(index) if index >= mark => {
                if let Dest::Prefer(register) = dst {
                    self.asm().mov(register, value);
                    self.top = mark;
                    return register.into();
                }
                self.top = index + 1;
            }
            _ => self.top = mark,
        }
        value
    }

    /// What is handed to [`Generator::expr`] before anything else is done.
    fn first_operand(&self, id: ExprId) -> Option<ExprId> {
        let base_of = |id: ExprId| match self.ast[id].kind {
            ExprKind::Dot { base, .. }
            | ExprKind::PrivateDot { base, .. }
            | ExprKind::Index { base, .. } => Some(base),
            _ => None,
        };
        match self.ast[id].kind {
            ExprKind::Call { callee, .. } | ExprKind::TaggedTemplate { tag: callee, .. } => {
                let member = match self.ast[callee].kind {
                    ExprKind::OptionalChain {
                        chain,
                        is_outermost: false,
                    } => chain,
                    _ => callee,
                };
                Some(base_of(member).unwrap_or(callee))
            }
            ExprKind::Binary { operator, lhs, .. } => self.leftmost_operand(operator, lhs),
            ExprKind::Delete { operand, .. } => base_of(operand).is_none().then_some(operand),
            ExprKind::Relation { lhs: first, .. }
            | ExprKind::New { callee: first, .. }
            | ExprKind::Unary { operand: first, .. }
            | ExprKind::Typeof { operand: first, .. }
            | ExprKind::Await(first)
            | ExprKind::Yield(Some(first))
            | ExprKind::YieldDelegate {
                argument: first, ..
            }
            | ExprKind::OptionalChain {
                chain: first,
                is_outermost: false,
            } => Some(first),
            _ => base_of(id),
        }
    }

    /// Returns where the value is if it is itself such an operand.
    #[cold]
    #[inline(never)]
    fn evaluate_first_operands(&mut self, id: ExprId) -> Option<Register> {
        if let Some((evaluated, register)) = self.evaluated {
            self.evaluated.take_if(|_| evaluated == id)?;
            return Some(register);
        }
        let floor = self.b.spine.len();
        let mut next = self.first_operand(id);
        while let Some(operand) = next {
            next = self.first_operand(operand);
            self.b.spine.extend(next.map(|_| operand));
        }
        if self.b.spine.len() > floor {
            // An operator may write its destination while it still needs its operand.
            let (mut dst, mut other) = (self.temp(), self.temp());
            while let Some(operand) = self.pop_spine(floor) {
                self.expr(operand, Dest::Temp(dst));
                self.evaluated = Some((operand, dst));
                core::mem::swap(&mut dst, &mut other);
            }
        }
        None
    }

    pub(super) fn pop_spine(&mut self, floor: usize) -> Option<ExprId> {
        if self.b.spine.len() > floor {
            self.b.spine.pop()
        } else {
            None
        }
    }

    #[inline]
    pub(super) fn pause_before(&mut self, node: &Expr) {
        if self.debugs && node.flags.contains(ExprFlags::PAUSE) {
            self.debug_hook(DebugHook::WillExecuteStatement, node.start);
        }
    }

    pub(super) fn effect(&mut self, id: ExprId) {
        let node = &self.ast[id];
        if self.is_literal(id)
            || matches!(
                node.kind,
                ExprKind::Declare {
                    kind: DeclarationKind::Var,
                    ..
                }
            )
        {
            return self.pause_before(node);
        }
        let mark = self.top;
        self.expr(id, Dest::Ignore);
        self.top = mark;
    }

    pub(super) fn expr_to_temp(&mut self, id: ExprId) -> Register {
        let register = self.temp();
        self.expr(id, Dest::Temp(register));
        register
    }

    /// A value that has to outlast the evaluation of what may assign to variables.
    #[inline]
    pub(super) fn stable_expr(&mut self, id: ExprId, later_assigns: bool) -> Operand {
        let mark = self.top;
        let value = self.expr(id, Dest::Any);
        if later_assigns && self.top == mark {
            self.copy_if_variable(value)
        } else {
            value
        }
    }

    pub(super) fn copy_if_variable(&mut self, value: Operand) -> Operand {
        if value.as_constant().is_some() || self.is_this(value) {
            return value;
        }
        let copy = self.temp();
        self.asm().mov(copy, value);
        copy.into()
    }

    fn is_this(&self, value: Operand) -> bool {
        match self.this {
            This::Register(this) | This::Unbound(this) | This::UnboundInScope(this) => {
                value == this
            }
            This::Undefined => false,
        }
    }

    /// For where the parser has not counted assignments.
    pub(super) fn may_assign(&self, mut id: ExprId) -> bool {
        loop {
            match self.ast[id].kind {
                ExprKind::Dot { base, .. } | ExprKind::PrivateDot { base, .. } => id = base,
                ExprKind::Identifier(_) | ExprKind::This | ExprKind::Function(_) => return false,
                _ => return !self.is_literal(id),
            }
        }
    }

    pub(super) fn is_literal(&self, id: ExprId) -> bool {
        matches!(
            self.ast[id].kind,
            ExprKind::Null
                | ExprKind::Boolean(_)
                | ExprKind::Number { .. }
                | ExprKind::String(_)
                | ExprKind::BigInt { .. }
        )
    }

    /// A string that is an index counts as a number.
    pub(super) fn key_expr(&mut self, id: ExprId, later_assigns: bool) -> Operand {
        match self.ast[id].kind {
            ExprKind::String(name) => self.key_constant(name),
            _ => self.stable_expr(id, later_assigns),
        }
    }

    fn dispatch(&mut self, node: &Expr, dst: Dest, tail: Tail) -> Operand {
        match node.kind {
            ExprKind::Null
            | ExprKind::Boolean(_)
            | ExprKind::Number { .. }
            | ExprKind::String(_)
            | ExprKind::BigInt { .. } => self.literal(node, dst),
            ExprKind::Identifier(name) => self.identifier_value(name, node.start, dst),
            ExprKind::This => {
                let this = self.this_value();
                self.deliver(dst, this)
            }
            ExprKind::Dot { .. } | ExprKind::PrivateDot { .. } | ExprKind::Index { .. } => {
                self.member(node, dst)
            }
            ExprKind::Call { .. } => self.call(node, dst, tail),
            ExprKind::New { .. } => self.construct(node, dst),
            ExprKind::Assign { operator, .. } => self.assign(node, operator, dst),
            ExprKind::Initialize { .. } => self.initialize_declarator(node),
            ExprKind::Declare { kind, name } => self.declare(kind, name),
            ExprKind::Destructure { pattern, value } => self.destructure(pattern, value, dst),
            ExprKind::Binary { .. } => self.binary(node, dst),
            ExprKind::Relation { .. } => self.relation(node, dst),
            ExprKind::Logical { operator, lhs, rhs } => self.logical(operator, lhs, rhs, dst, tail),
            ExprKind::Conditional { .. } => self.conditional(node, dst, tail),
            ExprKind::Unary { operator, operand } => self.unary(node.start, operator, operand, dst),
            ExprKind::Typeof { operand, end } => self.type_of(operand, end, dst),
            ExprKind::Delete { .. } => self.delete(node, dst),
            ExprKind::Prefix { .. } | ExprKind::Postfix { .. } => self.update(node, dst),
            ExprKind::Function(function) => {
                let dst = self.final_dst(dst);
                self.new_function(dst, function, node.start);
                dst.into()
            }
            ExprKind::Class(class) => self.class(node.start, class, None, dst),
            ExprKind::Array(elements) => self.array(elements, dst),
            ExprKind::Object { properties, home } => self.object(node.start, properties, home, dst),
            ExprKind::Template(template) => self.template(template, dst),
            ExprKind::TaggedTemplate { .. } => self.tagged_template(node, dst, tail),
            ExprKind::RegExp { pattern, flags } => self.regexp(pattern, flags, None, dst),
            ExprKind::Sequence(list) => self.sequence(list, dst, tail),
            ExprKind::OptionalChain {
                chain,
                is_outermost,
            } => self.optional_chain(chain, is_outermost, dst, tail),
            ExprKind::Yield(argument) => self.yield_value(argument, dst),
            ExprKind::YieldDelegate { .. } => self.yield_delegate(node, dst),
            ExprKind::Await(argument) => {
                let mark = self.top;
                let value = self.expr(argument, Dest::Any);
                self.top = mark;
                let dst = self.final_dst(dst);
                self.await_value(dst, value, node.start);
                dst.into()
            }
            ExprKind::Import { .. } => self.dynamic_import(node, dst),
            ExprKind::NewTarget => {
                let new_target = self.new_target_value();
                self.deliver(dst, new_target)
            }
            ExprKind::ImportMeta => {
                let variable = self.resolve(Name::IMPORT_META, node.start);
                self.position_at(node.start);
                self.load(&variable, None, dst, Unresolved::Throw)
            }
            // What contains these takes them apart.
            ExprKind::Super | ExprKind::PrivateName(_) | ExprKind::Spread { .. } => {
                self.undefined()
            }
        }
    }

    #[inline(never)]
    fn sequence(&mut self, list: List<ExprId>, dst: Dest, tail: Tail) -> Operand {
        let last = self.all_but_last(list);
        self.expr_in(last, dst, tail)
    }

    pub(super) fn all_but_last(&mut self, list: List<ExprId>) -> ExprId {
        let ast = self.ast;
        for id in ast.iter(list).take(list.len() as usize - 1) {
            self.effect(id);
        }
        ast.at(list, list.len() - 1)
    }

    // Names

    /// The properties of the global object that nothing can change or shadow.
    pub(super) fn global_constant(&mut self, variable: &Variable) -> Option<Operand> {
        if variable.place != Place::Global {
            return None;
        }
        if variable.name == Name::UNDEFINED {
            return Some(self.undefined());
        }
        match self.name_length(variable.name) {
            3 if self.text_of(variable.name).eq_ascii("NaN") => Some(self.double(f64::NAN)),
            8 if self.text_of(variable.name).eq_ascii("Infinity") => {
                Some(self.double(f64::INFINITY))
            }
            _ => None,
        }
    }

    #[inline(never)]
    fn identifier_value(&mut self, name: Name, start: u32, dst: Dest) -> Operand {
        if let Some(Builtin::Value(value)) = self.builtin(name) {
            return self.deliver(dst, value);
        }
        self.position_of_name(name, start);
        let variable = self.resolve_for_use(name, start);
        if let Some(constant) = self.global_constant(&variable) {
            return self.deliver(dst, constant);
        }
        let mark = self.top;
        let holder = self.holder(&variable);
        self.top = mark;
        self.load(&variable, holder, dst, Unresolved::Throw)
    }

    /// Sees to it that the `arguments` object or the rest array exists, if that is what the name refers to.
    #[inline]
    pub(super) fn resolve_for_use(&mut self, name: Name, position: u32) -> Variable {
        let variable = self.resolve(name, position);
        if name == Name::ARGUMENTS
            && let Arguments::Lazy {
                register,
                is_mapped,
            } = self.arguments
            && variable.place == Place::Register(register)
        {
            self.asm().ensure_arguments(register, is_mapped);
        } else if let Some(rest) = self.lazy_rest
            && rest.name == name
            && variable.place == Place::Register(rest.register)
        {
            self.asm().ensure_rest(rest.register, rest.skip);
            if self.asm().is_on_every_way() {
                self.lazy_rest = None;
            }
        }
        variable
    }

    /// If the expression is such a variable.
    pub(super) fn lazy_arguments(&mut self, id: ExprId) -> Option<Lazy> {
        let node = &self.ast[id];
        let ExprKind::Identifier(name) = node.kind else {
            return None;
        };
        let lazy = match self.arguments {
            Arguments::Lazy { register, .. } if name == Name::ARGUMENTS => {
                let skip = 0;
                Lazy {
                    name,
                    register,
                    skip,
                }
            }
            _ => self.lazy_rest.filter(|it| it.name == name)?,
        };
        let variable = self.resolve(name, node.start);
        (variable.place == Place::Register(lazy.register)).then_some(lazy)
    }

    pub(super) fn this_value(&mut self) -> Operand {
        match self.this {
            This::Register(this) => this.into(),
            This::Undefined => self.undefined(),
            This::Unbound(this) => {
                self.asm().check_this(this);
                this.into()
            }
            This::UnboundInScope(this) => {
                self.reload_this(this);
                self.asm().check_this(this);
                this.into()
            }
        }
    }

    pub(super) fn new_target_value(&mut self) -> Operand {
        (self.new_target).map_or_else(|| self.undefined(), Operand::from)
    }

    pub(super) fn this_slot(&mut self) -> Option<Place> {
        if self.inherits_context() {
            self.resolve_outer_internal(Name::THIS_VALUE)
        } else {
            self.own_internal(Name::THIS_VALUE)
        }
    }

    pub(super) fn reload_this(&mut self, this: Register) {
        if let Some(place) = self.this_slot() {
            self.load_internal(place, this);
        }
    }

    /// Whether `this` and its kin are those of the code around.
    pub(super) fn inherits_context(&self) -> bool {
        self.kind == CodeKind::Eval || self.function_kind == FunctionKind::Arrow
    }

    pub(super) fn load_home(&mut self, dst: Register) {
        let name = if self.inherits_context() {
            Name::HOME
        } else if self.function_flags.contains(FunctionFlags::STATIC) {
            Name::CLASS_STATIC_HOME
        } else {
            Name::CLASS_HOME
        };
        self.load_outer_internal(name, dst);
    }

    pub(super) fn load_outer_internal(&mut self, name: Name, dst: Register) {
        match self.resolve_outer_internal(name) {
            Some(place) => self.load_internal(place, dst),
            None => {
                let undefined = self.undefined();
                self.asm().mov(dst, undefined);
            }
        }
    }

    /// GetSuperBase.
    pub(super) fn super_base(&mut self) -> Register {
        let base = self.temp();
        self.load_home(base);
        self.asm().get_prototype_of(base, base);
        base
    }

    pub(super) fn eval_context(&self) -> EvalContext {
        let mut context = self.context;
        context.set(EvalContext::STRICT, self.is_strict);
        context
    }

    // Members

    pub(super) fn is_super(&self, id: ExprId) -> bool {
        matches!(self.ast[id].kind, ExprKind::Super)
    }

    /// Leaves the chain if `?.` follows the node and the value is undefined or null.
    #[inline]
    pub(super) fn check_optional_base(&mut self, base: ExprId, value: Operand) {
        let node = &self.ast[base];
        if node.flags.contains(ExprFlags::OPTIONAL_BASE) {
            self.optional_check(value, node.end);
        }
    }

    pub(super) fn optional_check(&mut self, value: Operand, text_start: u32) {
        let Some(&(target, text_end)) = self.b.optional_chains.last() else {
            return;
        };
        self.asm().jump_if_nullish(value, target);
        if !self.is_in_case_test {
            self.cover(text_start, text_end);
        }
    }

    pub(super) fn get_by_id(&mut self, dst: Register, base: Operand, name: Name) {
        if name == Name::LENGTH {
            self.asm().get_length(dst, base);
        } else {
            let name = self.identifier(name);
            self.asm().get_by_id(dst, base, name);
        }
    }

    #[inline(never)]
    fn member(&mut self, node: &Expr, dst: Dest) -> Operand {
        match node.kind {
            ExprKind::Dot {
                base,
                name: Name::LENGTH,
                divot,
                end,
            } if let Some(lazy) = self.lazy_arguments(base) => {
                let dst = self.final_dst(dst);
                self.position(divot, node.start, end);
                (self.asm()).get_arguments_length(dst, lazy.register, lazy.skip);
                dst.into()
            }
            ExprKind::Dot {
                base,
                name: Name::LENGTH,
                ..
            } if self.arguments == Arguments::OnlyLength
                && matches!(self.ast[base].kind, ExprKind::Identifier(Name::ARGUMENTS))
                && self.resolve(Name::ARGUMENTS, node.start).place == Place::Nowhere =>
            {
                let dst = self.final_dst(dst);
                self.asm().argument_count(dst);
                dst.into()
            }
            ExprKind::Index {
                base,
                key,
                divot,
                end,
                ..
            } if let Some(lazy) = self.lazy_arguments(base) => {
                let mark = self.top;
                let key = self.key_expr(key, false);
                let done = self.asm().label();
                let dst = match dst {
                    Dest::Any | Dest::Ignore if self.top > mark => Register::local(mark),
                    _ => self.final_dst(dst),
                };
                (self.asm()).get_argument_by_val(dst, lazy.register, key, lazy.skip, done);
                self.position(divot, node.start, end);
                self.resolve_for_use(lazy.name, node.start);
                self.asm().get_by_val(dst, lazy.register, key);
                self.asm().bind(done);
                dst.into()
            }
            _ => {
                let mark = self.top;
                let reference = self.member_reference(node, false);
                self.load_member(node, &reference, mark, dst)
            }
        }
    }

    #[inline(never)]
    fn optional_chain(
        &mut self,
        chain: ExprId,
        is_outermost: bool,
        dst: Dest,
        tail: Tail,
    ) -> Operand {
        if !is_outermost {
            return self.expr_in(chain, dst, tail);
        }
        let dst = match dst {
            Dest::Local(_) | Dest::Ignore => dst,
            _ => Dest::Temp(self.temp_dst(dst)),
        };
        let (nullish, done) = (self.asm().label(), self.asm().label());
        self.b.optional_chains.push((nullish, self.ast[chain].end));
        let value = self.expr_in(chain, dst, tail);
        self.b.optional_chains.pop();
        if dst == Dest::Ignore {
            self.asm().bind(nullish);
            return value;
        }
        self.asm().jump(done);
        self.asm().bind(nullish);
        let otherwise = match self.ast[chain].kind {
            ExprKind::Delete { .. } => self.boolean(true),
            _ => self.undefined(),
        };
        self.deliver(dst, otherwise);
        self.asm().bind(done);
        value
    }

    // Private names

    /// Throws unless `base` has the private methods of the class.
    pub(super) fn check_brand(
        &mut self,
        base: Operand,
        place: Place,
        flags: SlotFlags,
        brand: u32,
    ) {
        let mark = self.top;
        let brand = self.load_internal_beside(place, brand);
        if flags.contains(SlotFlags::STATIC) {
            let matches = self.asm().label();
            self.asm().jump_if_identical(base, brand, matches);
            self.throw_static(StaticError::StaticBrandMismatch);
            self.asm().bind(matches);
        } else {
            self.asm().check_private_brand(base, brand);
        }
        self.top = mark;
    }

    pub(super) fn has_private(
        &mut self,
        name: Name,
        base: Operand,
        mark: u32,
        dst: Dest,
    ) -> Operand {
        let Some((place, private)) = self.resolve_private(name) else {
            return self.undefined();
        };
        if private.kind == SlotKind::PrivateField {
            let symbol = self.temp();
            self.load_internal(place, symbol);
            self.top = mark;
            let dst = self.final_dst(dst);
            self.asm().has_private_name(dst, base, symbol);
            return dst.into();
        }
        let brand = self.load_internal_beside(place, private.brand_slot);
        self.top = mark;
        let dst = self.final_dst(dst);
        if private.flags.contains(SlotFlags::STATIC) {
            (self.asm()).throw_if_not_object(base, StaticError::StaticBrandOfNonObject);
            self.asm().identical(dst, base, brand);
        } else {
            self.asm().has_private_brand(dst, base, brand);
        }
        dst.into()
    }

    #[inline(never)]
    fn dynamic_import(&mut self, node: &Expr, dst: Dest) -> Operand {
        let ExprKind::Import {
            specifier,
            options,
            divot,
            end,
            is_deferred,
        } = node.kind
        else {
            return self.undefined();
        };
        let mark = self.top;
        let specifier = self.stable_expr(specifier, options.is_some());
        let options = match options {
            Some(options) => self.expr(options, Dest::Any),
            None => self.undefined(),
        };
        self.position(divot, node.start, end);
        self.top = mark;
        let (dst, scope) = (self.final_dst(dst), self.scope);
        let phase = if is_deferred {
            ImportPhase::Defer
        } else {
            ImportPhase::Evaluation
        };
        (self.asm()).dynamic_import(dst, specifier, options, scope, phase);
        dst.into()
    }
}
