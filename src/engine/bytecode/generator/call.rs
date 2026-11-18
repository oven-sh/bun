//! Calls and `new`.

use std::rc::Rc;

use bun_engine_syntax::ast::{CallFlags, Expr, ExprId, ExprKind, List};
use bun_engine_syntax::{EvalContext, Name, NameKind};

use super::function::Lazy;
use super::intrinsic::Builtin;
use super::{Dest, Generator, Tail, This};
use crate::assembler::{Assembler, Label};
use crate::code::CodeFlags;
use crate::constant::{Constant, LinkTimeConstant, TemplateSite};
use crate::function::Origin;
use crate::operand::{ArrayShape, DebugHook, Operand, Register, SpreadMaskIndex, Unresolved};

/// The room for the frame of a callee.
#[derive(Clone, Copy)]
pub(super) struct Frame {
    offset: u32,
    arguments: u32,
}

impl Frame {
    /// Free until the call is made.
    pub(super) fn this(self) -> Register {
        Register::from_offset(Register::THIS.offset() - self.offset as i32)
    }

    pub(super) fn argument(self, index: u32) -> Register {
        Register::outgoing_argument(self.offset, index)
    }

    pub(super) fn offset(self) -> u32 {
        self.offset
    }
}

/// Arguments that have been evaluated.
#[derive(Clone, Copy)]
enum Arguments {
    InFrame(Frame),
    One(Frame, Operand),
    Two(Frame, Operand, Operand),
    List(Varargs),
    Spread {
        /// Is for `this`, and counts.
        first: Register,
        count: u32,
        mask: SpreadMaskIndex,
        skip_in_frame: u32,
    },
}

#[derive(Clone, Copy)]
struct Varargs {
    list: Operand,
    skip_in_list: u32,
    skip_in_frame: u32,
}

impl Varargs {
    fn all_of(list: impl Into<Operand>) -> Self {
        Self::forwarding(list, None)
    }

    fn forwarding(list: impl Into<Operand>, lazy: Option<Lazy>) -> Self {
        Self {
            list: list.into(),
            skip_in_list: 0,
            skip_in_frame: lazy.map_or(0, |it| it.skip),
        }
    }
}

#[derive(Clone, Copy)]
struct Site {
    start: u32,
    divot: u32,
    end: u32,
    arguments: List<ExprId>,
    flags: CallFlags,
    tail: Tail,
}

impl Site {
    fn assigns(&self) -> bool {
        self.flags.contains(CallFlags::ARGUMENTS_ASSIGN)
    }

    fn spreads(&self) -> bool {
        self.flags.contains(CallFlags::SPREAD)
    }
}

impl Generator<'_> {
    pub(super) fn frame(&mut self, arguments: u32) -> Frame {
        let words = Register::HEADER_WORDS.saturating_add(arguments) + 1;
        let offset = (self.top.next_multiple_of(2)).saturating_add(words.next_multiple_of(2));
        self.set_top(offset);
        let offset = self.top;
        self.top = offset.saturating_sub(Register::HEADER_WORDS);
        Frame { offset, arguments }
    }

    fn frame_for(&mut self, site: &Site) -> Frame {
        self.frame(if site.spreads() {
            0
        } else {
            site.arguments.len()
        })
    }

    fn fill_frame(&mut self, frame: Frame, arguments: List<ExprId>) {
        for (index, argument) in (0..).zip(self.ast.iter(arguments)) {
            self.expr(argument, Dest::Temp(frame.argument(index)));
        }
    }

    /// Puts the elements in a run of registers. The holes come last, so that they are constants to the compilers
    /// wherever those take over.
    pub(super) fn run_of_elements(
        &mut self,
        elements: impl Iterator<Item = Option<ExprId>> + Clone,
        count: u32,
    ) -> Register {
        let first = self.temps(count);
        let places = (0..).map(|index| first.nth(index)).zip(elements);
        for (dst, element) in places.clone() {
            element.inspect(|&it| self.element(dst, it));
        }
        for (dst, _) in places.filter(|it| it.1.is_none()) {
            let hole = self.empty();
            self.asm().mov(dst, hole);
        }
        first
    }

    /// The same, with those that are spread as lists.
    pub(super) fn spread_elements(
        &mut self,
        elements: impl Iterator<Item = Option<ExprId>> + Clone,
        count: u32,
    ) -> (Register, SpreadMaskIndex) {
        let first = self.run_of_elements(elements.clone(), count);
        (first, self.spread_mask(elements))
    }

    fn is_spread(&self, element: ExprId) -> bool {
        matches!(self.ast[element].kind, ExprKind::Spread { .. })
    }

    fn spread_mask(&mut self, elements: impl Iterator<Item = Option<ExprId>>) -> SpreadMaskIndex {
        let ast = self.ast;
        let is_spread = |it: ExprId| matches!(ast[it].kind, ExprKind::Spread { .. });
        (self.asm()).add_spread_mask(elements.map(|it| it.is_some_and(is_spread)))
    }

    fn element(&mut self, dst: Register, element: ExprId) {
        self.argument(dst, element, |_| false);
    }

    /// Gives what `dst` stands for if it is empty, which is only what `may_forward` allows.
    fn argument(
        &mut self,
        dst: Register,
        argument: ExprId,
        may_forward: impl FnOnce(Lazy) -> bool,
    ) -> Option<Lazy> {
        let node = &self.ast[argument];
        let ExprKind::Spread { value, divot, end } = node.kind else {
            self.expr(argument, Dest::Temp(dst));
            return None;
        };
        let lazy = self.lazy_arguments(value);
        let forwarded = lazy.filter(|&it| may_forward(it));
        let done = lazy.map(|Lazy { register, skip, .. }| {
            let done = self.asm().label();
            self.position(divot, node.start, end);
            (self.asm()).spread_arguments(dst, register, skip, forwarded.is_some(), done);
            done
        });
        let iterable = self.expr(value, Dest::Prefer(dst));
        self.position(divot, node.start, end);
        self.asm().spread(dst, iterable);
        done.inspect(|&done| self.asm().bind(done));
        forwarded
    }

    fn spread_arguments(&mut self, arguments: List<ExprId>) -> Arguments {
        let (ast, count) = (self.ast, arguments.len());
        if count == 1 {
            return Arguments::List(self.argument_list(arguments));
        }
        let (first, mut forwarded) = (self.temps(count + 1), None::<Lazy>);
        for (index, argument) in (1..).zip(ast.iter(arguments)) {
            let fits = |it: Lazy| forwarded.is_none_or(|earlier| earlier.skip == it.skip);
            forwarded = self
                .argument(first.nth(index), argument, fits)
                .or(forwarded);
        }
        Arguments::Spread {
            first,
            count: count + 1,
            mask: self.spread_mask(ast.iter(arguments).map(Some)),
            skip_in_frame: forwarded.map_or(0, |it| it.skip),
        }
    }

    /// All of them as one list.
    fn argument_list(&mut self, arguments: List<ExprId>) -> Varargs {
        if arguments.len() != 1 {
            return Varargs::all_of(self.argument_array(arguments));
        }
        let list = self.temp();
        let forwarded = self.argument(list, self.ast.at(arguments, 0), |_| true);
        Varargs::forwarding(list, forwarded)
    }

    fn argument_array(&mut self, arguments: List<ExprId>) -> Register {
        let (ast, count) = (self.ast, arguments.len());
        let (first, mask) = self.spread_elements(ast.iter(arguments).map(Some), count);
        self.asm().new_array_with_spread(first, first, count, mask);
        first
    }

    /// Of what `argument_array` has made. Undefined if there is none, whatever the prototypes have.
    fn first_argument(&mut self, dst: Register, array: Operand) {
        let (present, done) = (self.asm().label(), self.asm().label());
        let (zero, undefined) = (self.int32(0), self.undefined());
        self.asm().get_length(dst, array);
        self.asm().jump_if_not_identical(dst, zero, present);
        self.asm().mov(dst, undefined);
        self.asm().jump(done);
        self.asm().bind(present);
        self.asm().get_by_val(dst, array, zero);
        self.asm().bind(done);
    }

    fn evaluate_arguments(&mut self, frame: Frame, site: &Site, list: List<ExprId>) -> Arguments {
        let ast = self.ast;
        if site.spreads() {
            return self.spread_arguments(list);
        }
        match (list.len(), site.tail) {
            (1, Tail::No) => {
                let first = self.expr(ast.at(list, 0), Dest::Prefer(frame.argument(0)));
                Arguments::One(frame, first)
            }
            (2, Tail::No) => {
                let first = if site.assigns() {
                    Dest::Temp(frame.argument(0))
                } else {
                    Dest::Prefer(frame.argument(0))
                };
                let first = self.expr(ast.at(list, 0), first);
                let second = self.expr(ast.at(list, 1), Dest::Prefer(frame.argument(1)));
                Arguments::Two(frame, first, second)
            }
            _ => {
                self.fill_frame(frame, list);
                Arguments::InFrame(frame)
            }
        }
    }

    fn before_call(&mut self, site: &Site) {
        self.debug_hook(DebugHook::WillExecuteExpression, site.start);
        self.position(site.divot, site.start, site.end);
    }

    fn emit_call(
        &mut self,
        dst: Register,
        callee: Operand,
        this: Operand,
        arguments: Arguments,
        tail: Tail,
    ) {
        match (arguments, tail) {
            (Arguments::One(frame, first), _) => {
                self.asm().call1(dst, callee, this, first, frame.offset);
            }
            (Arguments::Two(frame, first, second), _) => {
                (self.asm()).call2(dst, callee, this, first, second, frame.offset);
            }
            (Arguments::InFrame(frame), Tail::No) => {
                (self.asm()).call(dst, callee, this, frame.arguments + 1, frame.offset);
            }
            (Arguments::InFrame(frame), Tail::Yes) => {
                let kept = self.before_tail_call();
                (self.asm()).tail_call(dst, callee, this, frame.arguments + 1, frame.offset);
                self.after_tail_call(dst, kept, |asm| {
                    asm.call(dst, callee, this, frame.arguments + 1, frame.offset);
                });
            }
            (
                Arguments::Spread {
                    first,
                    count,
                    mask,
                    skip_in_frame: skip,
                },
                _,
            ) => {
                self.mov(first, this);
                let call = |asm: &mut Assembler| {
                    asm.call_with_spread(dst, callee, first, count, mask, skip);
                };
                if tail == Tail::No {
                    return call(self.asm());
                }
                let kept = self.before_tail_call();
                (self.asm()).tail_call_with_spread(dst, callee, first, count, mask, skip);
                self.after_tail_call(dst, kept, call);
            }
            (Arguments::List(varargs), _) => {
                let (list, in_list, in_frame) =
                    (varargs.list, varargs.skip_in_list, varargs.skip_in_frame);
                let call = |asm: &mut Assembler| {
                    asm.call_varargs(dst, callee, this, list, in_list, in_frame);
                };
                if tail == Tail::No {
                    return call(self.asm());
                }
                let kept = self.before_tail_call();
                (self.asm()).tail_call_varargs(dst, callee, this, list, in_list, in_frame);
                self.after_tail_call(dst, kept, call);
            }
        }
    }

    /// Where the call is made if the frame stays for a debugger to see.
    fn before_tail_call(&mut self) -> Option<Label> {
        self.debugs.then(|| {
            let kept = self.asm().label();
            self.asm().jump_if_frame_is_kept(kept);
            kept
        })
    }

    fn after_tail_call(
        &mut self,
        dst: Register,
        kept: Option<Label>,
        call: impl FnOnce(&mut Assembler),
    ) {
        self.flags |= CodeFlags::HAS_TAIL_CALLS;
        self.asm().ret(dst);
        if let Some(kept) = kept {
            self.asm().bind(kept);
            call(self.asm());
            self.asm().debug(DebugHook::DidReturnFromTailCall);
            self.asm().ret(dst);
        }
    }

    /// A call that is not in the source.
    pub(super) fn call_method(
        &mut self,
        dst: Register,
        callee: Register,
        this: Operand,
        argument: Option<Operand>,
    ) {
        let mark = self.top;
        let frame = self.frame(u32::from(argument.is_some()));
        match argument {
            Some(argument) => self.asm().call1(dst, callee, this, argument, frame.offset),
            None => self.asm().call(dst, callee, this, 1, frame.offset),
        }
        self.top = mark;
    }

    pub(super) fn call_accessor(
        &mut self,
        start: u32,
        dst: Register,
        accessor: Register,
        this: Operand,
        argument: Option<Operand>,
    ) {
        self.debug_hook(DebugHook::WillExecuteExpression, start);
        self.position_at(start);
        self.call_method(dst, accessor, this, argument);
    }

    /// The register for the result, given the one that holds the callee.
    fn result_register(dst: Dest, function: Register) -> Register {
        match dst {
            Dest::Local(register) => register,
            _ => function,
        }
    }

    fn check_optional_call(&mut self, site: &Site, callee: Operand) {
        if site.flags.contains(CallFlags::OPTIONAL) {
            self.optional_check(callee, site.divot - 2);
        }
    }

    #[inline(never)]
    pub(super) fn call(&mut self, node: &Expr, dst: Dest, tail: Tail) -> Operand {
        let ExprKind::Call {
            callee,
            arguments,
            divot,
            end,
            flags,
        } = node.kind
        else {
            return self.undefined();
        };
        let site = Site {
            start: node.start,
            divot,
            end,
            arguments,
            flags,
            tail,
        };
        let callee_node = &self.ast[callee];
        match callee_node.kind {
            ExprKind::Super => return self.super_call(&site, dst),
            ExprKind::Identifier(Name::EVAL) if !flags.contains(CallFlags::OPTIONAL) => {
                return self.eval_call(callee, &site, dst);
            }
            ExprKind::Identifier(name) => {
                if let Some(Builtin::Intrinsic(intrinsic)) = self.builtin(name) {
                    return self.intrinsic(intrinsic, node, arguments, dst);
                }
            }
            ExprKind::Dot { base, name, .. } if !self.is_super(base) => {
                if let Some(result) = self.special_method_call(callee_node, base, name, &site, dst)
                {
                    return result;
                }
            }
            _ => {}
        }
        let function = self.temp_dst(dst);
        let frame = self.frame_for(&site);
        let (callee_value, this) =
            self.callee(callee, site.start, function, frame.this(), site.assigns());
        self.check_optional_call(&site, callee_value);
        let arguments = self.evaluate_arguments(frame, &site, arguments);
        self.before_call(&site);
        let result = Self::result_register(dst, function);
        self.unless_allocation(callee, callee_value, arguments, result, |generator| {
            generator.emit_call(result, callee_value, this, arguments, tail);
        });
        result.into()
    }

    /// The function and its `this`. The registers are for them, if they need any.
    fn callee(
        &mut self,
        callee: ExprId,
        start: u32,
        function: Register,
        this: Register,
        later_assigns: bool,
    ) -> (Operand, Operand) {
        let node = &self.ast[callee];
        match node.kind {
            ExprKind::Identifier(name) if self.builtin(name).is_none() => {
                self.position_of_name(name, start);
                let variable = self.resolve_for_use(name, node.start);
                if let Some(constant) = self.global_constant(&variable) {
                    return (constant, self.undefined());
                }
                let mark = self.top;
                let holder = self.holder(&variable);
                let dst = if later_assigns {
                    Dest::Temp(function)
                } else {
                    Dest::Prefer(function)
                };
                let value = self.load(&variable, holder, dst, Unresolved::Throw);
                self.top = mark;
                match holder {
                    Some(holder) => {
                        self.asm().get_dynamic_this(this, holder);
                        (value, this.into())
                    }
                    None => (value, self.undefined()),
                }
            }
            ExprKind::Dot { .. } | ExprKind::PrivateDot { .. } | ExprKind::Index { .. } => (
                function.into(),
                self.method(node, function, this, later_assigns),
            ),
            // `(a?.b)()` and `a?.b?.()` keep their receiver.
            ExprKind::OptionalChain {
                chain,
                is_outermost,
            } if matches!(
                self.ast[chain].kind,
                ExprKind::Dot { .. } | ExprKind::PrivateDot { .. } | ExprKind::Index { .. }
            ) =>
            {
                let member = &self.ast[chain];
                if !is_outermost {
                    return (
                        function.into(),
                        self.method(member, function, this, later_assigns),
                    );
                }
                let (nullish, done) = (self.asm().label(), self.asm().label());
                self.b.optional_chains.push((nullish, member.end));
                let receiver = self.method(member, function, this, true);
                self.mov(this, receiver);
                self.b.optional_chains.pop();
                self.asm().jump(done);
                self.asm().bind(nullish);
                let undefined = self.undefined();
                self.asm().mov(function, undefined);
                self.asm().mov(this, undefined);
                self.asm().bind(done);
                (function.into(), this.into())
            }
            _ => {
                let dst = if later_assigns {
                    Dest::Temp(function)
                } else {
                    Dest::Prefer(function)
                };
                (self.expr(callee, dst), self.undefined())
            }
        }
    }

    /// Loads the function and returns the receiver.
    fn method(
        &mut self,
        node: &Expr,
        function: Register,
        this: Register,
        later_assigns: bool,
    ) -> Operand {
        if let ExprKind::Dot { base, name, .. } = node.kind
            && let ExprKind::RegExp { pattern, flags } = self.ast[base].kind
        {
            let receiver = self.regexp(pattern, flags, Some(name), Dest::Temp(this));
            self.position_of_member(node);
            self.get_by_id(function, receiver, name);
            return receiver;
        }
        let mark = self.top;
        let member = self.member_reference_with_base(node, later_assigns, Dest::Prefer(this));
        self.load_member(node, &member, mark, Dest::Temp(function));
        self.top = mark;
        match member.this {
            Some(this) => this,
            None if member.base.as_register().and_then(Register::local_index) >= Some(mark) => {
                self.asm().mov(this, member.base);
                this.into()
            }
            None => member.base,
        }
    }

    /// `Array(n)` and `Object()` allocate in place while those names mean what they usually do.
    #[inline(never)]
    fn unless_allocation(
        &mut self,
        callee: ExprId,
        function: Operand,
        arguments: Arguments,
        dst: Register,
        otherwise: impl FnOnce(&mut Self),
    ) {
        let node = &self.ast[callee];
        let ExprKind::Identifier(name) = node.kind else {
            return otherwise(self);
        };
        let argument = match arguments {
            Arguments::InFrame(frame) if frame.arguments == 0 => None,
            Arguments::InFrame(frame) if frame.arguments == 1 => Some(frame.argument(0).into()),
            Arguments::One(_, argument) => Some(argument),
            _ => return otherwise(self),
        };
        let expected = match self.constant_of(function) {
            Some(&Constant::LinkTime(constant)) => constant,
            _ if name == Name::ARRAY => LinkTimeConstant::ARRAY,
            _ if name == Name::OBJECT => LinkTimeConstant::OBJECT,
            _ => return otherwise(self),
        };
        let is_array = expected == LinkTimeConstant::ARRAY;
        if self.debugs
            || !(is_array || (expected == LinkTimeConstant::OBJECT && argument.is_none()))
        {
            return otherwise(self);
        }
        let done = self.asm().label();
        if let Some(function) = function.as_register() {
            if self.resolve(name, node.start).register().is_some() {
                return otherwise(self);
            }
            let (expected, allocate) = (self.link_time(expected), self.asm().label());
            self.asm().jump_if_builtin(function, expected, allocate);
            otherwise(self);
            self.asm().jump(done);
            self.asm().bind(allocate);
        }
        match (is_array, argument) {
            (true, Some(length)) => self.asm().new_array_with_size(dst, length),
            (true, None) => (self.asm()).new_array(dst, Register::SCOPE, 0, ArrayShape::Undecided),
            (false, _) => self.asm().new_object(dst, 0),
        }
        self.asm().bind(done);
    }

    #[inline(never)]
    pub(super) fn construct(&mut self, node: &Expr, dst: Dest) -> Operand {
        let ExprKind::New {
            callee,
            arguments,
            divot,
            end,
            flags,
        } = node.kind
        else {
            return self.undefined();
        };
        let function = self.temp_dst(dst);
        let result = Self::result_register(dst, function);
        let constructor = if flags.contains(CallFlags::ARGUMENTS_ASSIGN) {
            self.expr(callee, Dest::Temp(function))
        } else {
            self.expr(callee, Dest::Prefer(function))
        };
        if flags.contains(CallFlags::SPREAD) {
            let all = self.argument_list(arguments);
            let (list, skip) = (all.list, all.skip_in_frame);
            self.position(divot, node.start, end);
            (self.asm()).construct_varargs(result, constructor, constructor, list, skip);
            return result.into();
        }
        let frame = self.frame(arguments.len());
        self.fill_frame(frame, arguments);
        self.position(divot, node.start, end);
        let arguments = Arguments::InFrame(frame);
        self.unless_allocation(callee, constructor, arguments, result, |generator| {
            let count = frame.arguments + 1;
            (generator.asm()).construct(result, constructor, constructor, count, frame.offset);
        });
        result.into()
    }

    #[inline(never)]
    fn super_call(&mut self, site: &Site, dst: Dest) -> Operand {
        let result = self.temp_dst(dst);
        if self.inherits_context() {
            self.load_outer_internal(Name::ACTIVE_FUNCTION, result);
            self.asm().get_prototype_of(result, result);
        } else {
            self.asm().get_prototype_of(result, Register::CALLEE);
        }
        let new_target = self.new_target_value();
        let new_target = self.in_register(new_target);
        if site.spreads() {
            let all = self.argument_list(site.arguments);
            let (list, skip) = (all.list, all.skip_in_frame);
            self.position(site.divot, site.start, site.end);
            (self.asm()).super_construct_varargs(result, result, new_target, list, skip);
        } else {
            let frame = self.frame(site.arguments.len());
            self.fill_frame(frame, site.arguments);
            self.position(site.divot, site.start, site.end);
            let count = frame.arguments + 1;
            (self.asm()).super_construct(result, result, new_target, count, frame.offset);
        }
        self.bind_this(result);
        self.deliver(dst, result)
    }

    /// What follows the return of the constructor of the parent.
    pub(super) fn bind_this(&mut self, value: Register) {
        let this = match self.this {
            This::UnboundInScope(this) => {
                self.reload_this(this);
                this
            }
            This::Register(this) | This::Unbound(this) => this,
            This::Undefined => return,
        };
        self.asm().bind_this(this, value);
        if let Some(place) = self.this_slot() {
            self.put(place, Name::THIS_VALUE, None, this.into());
        }
        self.initialize_fields(this);
    }

    pub(super) fn initialize_fields(&mut self, this: Register) {
        if !self.context.contains(EvalContext::HAS_FIELD_INITIALIZER) {
            return;
        }
        let (mark, initializer) = (self.top, self.temp());
        let name = if self.inherits_context() {
            Name::FIELD_INITIALIZER
        } else {
            Name::CLASS_FIELD_INITIALIZER
        };
        self.load_outer_internal(name, initializer);
        self.call_method(initializer, initializer, this.into(), None);
        self.top = mark;
    }

    #[inline(never)]
    fn eval_call(&mut self, callee: ExprId, site: &Site, dst: Dest) -> Operand {
        let function = self.temp_dst(dst);
        let result = Self::result_register(dst, function);
        let frame = self.frame_for(site);
        let (_, this) = self.callee(callee, site.start, function, frame.this(), true);
        let arguments = if site.spreads() {
            Arguments::List(Varargs::all_of(self.argument_array(site.arguments)))
        } else {
            self.fill_frame(frame, site.arguments);
            Arguments::InFrame(frame)
        };
        let (direct, done) = (self.asm().label(), self.asm().label());
        let eval = self.link_time(LinkTimeConstant::EVAL);
        self.asm().jump_if_builtin(function, eval, direct);
        self.position(site.divot, site.start, site.end);
        self.emit_call(result, function.into(), this, arguments, site.tail);
        self.asm().jump(done);
        self.asm().bind(direct);
        let source = match arguments {
            Arguments::List(array) => {
                self.first_argument(function, array.list);
                function.into()
            }
            _ if site.arguments.is_empty() => self.undefined(),
            _ => frame.argument(0).into(),
        };
        self.position(site.divot, site.start, site.end);
        let (scope, context) = (self.scope, self.eval_context());
        self.asm().direct_eval(result, source, scope, context);
        self.asm().bind(done);
        result.into()
    }

    #[inline(never)]
    pub(super) fn tagged_template(&mut self, node: &Expr, dst: Dest, tail: Tail) -> Operand {
        let ExprKind::TaggedTemplate {
            tag,
            template,
            divot,
            end,
        } = node.kind
        else {
            return self.undefined();
        };
        let ast = self.ast;
        let template = &ast[template];
        let function = self.temp_dst(dst);
        let frame = self.frame(template.expressions.len() + 1);
        let assigns = (ast.iter(template.expressions)).any(|id| self.may_assign(id));
        let (callee, this) = self.callee(tag, node.start, function, frame.this(), assigns);
        let site = TemplateSite {
            cooked: (ast.iter(template.cooked))
                .map(|part| part.map(|part| self.atom(part)))
                .collect(),
            raw: (ast.iter(template.raw).flatten())
                .map(|part| self.atom(part))
                .collect(),
            end,
        };
        let object = self.add_constant(Constant::Template(Rc::new(site)));
        self.asm().mov(frame.argument(0), Operand::constant(object));
        for (index, expression) in (1..).zip(ast.iter(template.expressions)) {
            self.expr(expression, Dest::Temp(frame.argument(index)));
        }
        self.debug_hook(DebugHook::WillExecuteExpression, node.start);
        self.position(divot, node.start, end);
        let result = Self::result_register(dst, function);
        self.emit_call(result, callee, this, Arguments::InFrame(frame), tail);
        result.into()
    }

    // Methods that are worth a shortcut

    fn is_named(&self, id: ExprId, name: Name) -> bool {
        matches!(self.ast[id].kind, ExprKind::Identifier(it) if it == name)
    }

    #[inline(never)]
    fn special_method_call(
        &mut self,
        callee: &Expr,
        base: ExprId,
        mut name: Name,
        site: &Site,
        dst: Dest,
    ) -> Option<Operand> {
        if self.ast.names.kind(name) == NameKind::Private {
            let text = self.text_of(name);
            name = [(Name::CALL, "call"), (Name::APPLY, "apply")]
                .into_iter()
                .find_map(|(name, candidate)| text.eq_ascii(candidate).then_some(name))?;
        }
        match name {
            Name::CALL => Some(self.call_call(callee, base, site, dst)),
            Name::APPLY if !self.is_named(base, Name::REFLECT) => {
                self.call_apply(callee, base, site, dst)
            }
            Name::HAS_OWN_PROPERTY => self.call_has_own_property(callee, base, site, dst),
            Name::CONSTRUCT if self.is_named(base, Name::REFLECT) => {
                self.call_reflect_construct(callee, base, site, dst)
            }
            _ => None,
        }
    }

    /// The receiver, and the method unless a built-in takes it for granted.
    fn receiver_and_method(
        &mut self,
        callee: &Expr,
        base: ExprId,
        name: Name,
        site: &Site,
        method: Register,
    ) -> (Operand, Option<Register>) {
        let receiver = self.stable_expr(base, site.assigns());
        self.check_optional_base(base, receiver);
        self.position_of_member(callee);
        if self.origin.contains(Origin::BUILTIN) && matches!(name, Name::CALL | Name::APPLY) {
            return (receiver, None);
        }
        self.get_by_id(method, receiver, name);
        self.check_optional_call(site, method.into());
        (receiver, Some(method))
    }

    /// Runs `general` unless the method is the built-in one, in which case control gets past it. The label is to
    /// be bound after the shortcut.
    fn unless_builtin(
        &mut self,
        method: Option<Register>,
        builtin: LinkTimeConstant,
        general: impl FnOnce(&mut Self, Register),
    ) -> crate::assembler::Label {
        let done = self.asm().label();
        if let Some(method) = method {
            let (builtin, shortcut) = (self.link_time(builtin), self.asm().label());
            self.asm().jump_if_builtin(method, builtin, shortcut);
            let mark = self.top;
            general(self, method);
            self.top = mark;
            self.asm().jump(done);
            self.asm().bind(shortcut);
        }
        done
    }

    fn operand_of(arguments: Arguments, index: u32) -> Option<Operand> {
        match (arguments, index) {
            (Arguments::InFrame(frame), _) => Some(frame.argument(index).into()),
            (Arguments::One(_, it) | Arguments::Two(_, it, _), 0)
            | (Arguments::Two(_, _, it), 1) => Some(it),
            _ => None,
        }
    }

    fn receiver_argument(&mut self, site: &Site, frame: Frame) -> Operand {
        match self.ast.get(site.arguments, 0) {
            Some(first) if site.assigns() => self.expr(first, Dest::Temp(frame.this())),
            Some(first) => self.expr(first, Dest::Prefer(frame.this())),
            None => self.undefined(),
        }
    }

    /// `f.call(this, ..)`
    fn call_call(&mut self, callee: &Expr, base: ExprId, site: &Site, dst: Dest) -> Operand {
        let method = self.temp_dst(dst);
        let result = Self::result_register(dst, method);
        let (function, method) = self.receiver_and_method(callee, base, Name::CALL, site, method);
        let builtin = LinkTimeConstant::FUNCTION_PROTOTYPE_CALL;
        if site.spreads() {
            let done = self.call_call_with_spread(function, method, site, result);
            self.asm().bind(done);
            return result.into();
        }
        let rest = site.arguments.skip(1);
        let frame = self.frame(rest.len());
        let this = self.receiver_argument(site, frame);
        let arguments = self.evaluate_arguments(frame, site, rest);
        self.before_call(site);
        let done = self.unless_builtin(method, builtin, |generator, method| {
            let all = generator.frame(site.arguments.len());
            for index in 0..site.arguments.len() {
                let value = index.checked_sub(1);
                let value = value.and_then(|index| Self::operand_of(arguments, index));
                generator.mov(all.argument(index), value.unwrap_or(this));
            }
            let all = Arguments::InFrame(all);
            generator.emit_call(result, method.into(), function, all, site.tail);
        });
        self.emit_call(result, function, this, arguments, site.tail);
        self.asm().bind(done);
        result.into()
    }

    fn call_call_with_spread(
        &mut self,
        function: Operand,
        method: Option<Register>,
        site: &Site,
        result: Register,
    ) -> Label {
        let (ast, rest) = (self.ast, site.arguments.skip(1));
        let has_this = !self.is_spread(ast.at(site.arguments, 0));
        let all = match has_this {
            true => self.spread_arguments(site.arguments),
            false => Arguments::List(Varargs::all_of(self.argument_array(site.arguments))),
        };
        self.before_call(site);
        let builtin = LinkTimeConstant::FUNCTION_PROTOTYPE_CALL;
        let done = self.unless_builtin(method, builtin, |generator, method| {
            generator.emit_call(result, method.into(), function, all, site.tail);
        });
        let (this, others) = match all {
            Arguments::Spread {
                first,
                count: 3,
                skip_in_frame,
                ..
            } => {
                let only = Varargs::all_of(first.nth(2));
                let only = Varargs {
                    skip_in_frame,
                    ..only
                };
                (first.nth(1), Arguments::List(only))
            }
            Arguments::Spread {
                first,
                count,
                skip_in_frame,
                ..
            } => {
                let others = Arguments::Spread {
                    first: first.nth(1),
                    count: count - 1,
                    mask: self.spread_mask(ast.iter(rest).map(Some)),
                    skip_in_frame,
                };
                (first.nth(1), others)
            }
            Arguments::List(array) => {
                let (this, skip_in_list) = (self.temp(), 1);
                self.first_argument(this, array.list);
                let others = Varargs {
                    skip_in_list,
                    ..array
                };
                (this, Arguments::List(others))
            }
            _ => unreachable!("it spreads"),
        };
        self.emit_call(result, function, this.into(), others, site.tail);
        done
    }

    /// The elements of an array literal without holes or spreads.
    fn plain_elements(&self, id: ExprId) -> Option<List<Option<ExprId>>> {
        let ast = self.ast;
        let ExprKind::Array(elements) = ast[id].kind else {
            return None;
        };
        ast.iter(elements)
            .all(|it| it.is_some_and(|it| !matches!(ast[it].kind, ExprKind::Spread { .. })))
            .then_some(elements)
    }

    fn fill_frame_with_elements(&mut self, elements: List<Option<ExprId>>) -> Frame {
        let frame = self.frame(elements.len());
        for (index, element) in (0..).zip(self.ast.iter(elements).flatten()) {
            self.element(frame.argument(index), element);
        }
        frame
    }

    fn array_of_frame(&mut self, dst: Register, frame: Frame) {
        let (mark, first) = (self.top, self.temps(frame.arguments.max(1)));
        for index in 0..frame.arguments {
            self.asm().mov(first.nth(index), frame.argument(index));
        }
        (self.asm()).new_array(dst, first, frame.arguments, ArrayShape::Undecided);
        self.top = mark;
    }

    /// `f.apply(this, arguments)`
    fn call_apply(
        &mut self,
        callee: &Expr,
        base: ExprId,
        site: &Site,
        dst: Dest,
    ) -> Option<Operand> {
        let (ast, count) = (self.ast, site.arguments.len());
        if (site.spreads() || count > 2) && !self.origin.contains(Origin::BUILTIN) {
            return None;
        }
        let method = self.temp_dst(dst);
        let result = Self::result_register(dst, method);
        let (function, method) = self.receiver_and_method(callee, base, Name::APPLY, site, method);
        let this = match ast.get(site.arguments, 0) {
            Some(first) => self.stable_expr(first, site.assigns()),
            None => self.undefined(),
        };
        let builtin = LinkTimeConstant::FUNCTION_PROTOTYPE_APPLY;
        let second = ast.get(site.arguments, 1);
        let elements = second.map_or(Some(List::EMPTY), |second| self.plain_elements(second));
        let done = if let Some(elements) = elements {
            let frame = self.fill_frame_with_elements(elements);
            self.before_call(site);
            let done = self.unless_builtin(method, builtin, |generator, method| {
                let real = generator.frame(count);
                if count > 0 {
                    generator.mov(real.argument(0), this);
                }
                if count > 1 {
                    generator.array_of_frame(real.argument(1), frame);
                }
                let real = Arguments::InFrame(real);
                generator.emit_call(result, method.into(), function, real, site.tail);
            });
            self.emit_call(result, function, this, Arguments::InFrame(frame), site.tail);
            done
        } else {
            let second = second?;
            let lazy = self.lazy_arguments(second);
            let list = match lazy {
                Some(lazy) => lazy.register.into(),
                None => self.expr(second, Dest::Any),
            };
            self.before_call(site);
            let done = self.unless_builtin(method, builtin, |generator, method| {
                if let Some(lazy) = lazy {
                    generator.resolve_for_use(lazy.name, site.start);
                }
                let real = generator.frame(2);
                generator.mov(real.argument(0), this);
                generator.mov(real.argument(1), list);
                let real = Arguments::InFrame(real);
                generator.emit_call(result, method.into(), function, real, site.tail);
            });
            let values = self.temp();
            self.asm().to_argument_list(values, list);
            let values = Arguments::List(Varargs::forwarding(values, lazy));
            self.emit_call(result, function, this, values, site.tail);
            done
        };
        self.asm().bind(done);
        Some(result.into())
    }

    /// `o.hasOwnProperty(k)` in `for (k in o)`
    fn call_has_own_property(
        &mut self,
        callee: &Expr,
        base: ExprId,
        site: &Site,
        dst: Dest,
    ) -> Option<Operand> {
        if site.arguments.len() != 1 {
            return None;
        }
        let argument = self.ast.at(site.arguments, 0);
        let key = self.register_of(argument)?;
        let subject = self.register_of(base)?;
        let state = self.for_in_state(key, Some(subject))?;
        let method = self.temp_dst(dst);
        let result = Self::result_register(dst, method);
        let name = Name::HAS_OWN_PROPERTY;
        let (object, method) = self.receiver_and_method(callee, base, name, site, method);
        self.expr(argument, Dest::Any);
        self.before_call(site);
        let builtin = LinkTimeConstant::OBJECT_PROTOTYPE_HAS_OWN_PROPERTY;
        self.link_time(builtin);
        self.note_for_in_use(key);
        let done = self.unless_builtin(method, builtin, |generator, method| {
            let frame = generator.frame(1);
            let arguments = if site.tail == Tail::Yes {
                generator.mov(frame.argument(0), key);
                Arguments::InFrame(frame)
            } else {
                Arguments::One(frame, key.into())
            };
            generator.emit_call(result, method.into(), object, arguments, site.tail);
        });
        self.asm().for_in_has_own(result, object, key, state);
        self.asm().bind(done);
        Some(result.into())
    }

    /// The register of the variable that the expression is.
    pub(super) fn register_of(&mut self, id: ExprId) -> Option<Register> {
        let node = &self.ast[id];
        match (node.kind, self.this) {
            (ExprKind::Identifier(name), _) => self.resolve(name, node.start).register(),
            (ExprKind::This, This::Register(this)) => Some(this),
            _ => None,
        }
    }

    fn call_reflect_construct(
        &mut self,
        callee: &Expr,
        base: ExprId,
        site: &Site,
        dst: Dest,
    ) -> Option<Operand> {
        let (ast, count) = (self.ast, site.arguments.len());
        if site.spreads() || !(2..=3).contains(&count) {
            return None;
        }
        let method = self.temp_dst(dst);
        let result = Self::result_register(dst, method);
        let (reflect, _) = self.receiver_and_method(callee, base, Name::CONSTRUCT, site, method);
        let real = self.frame(count);
        let (target, list) = (real.argument(0), real.argument(1));
        self.expr(ast.at(site.arguments, 0), Dest::Temp(target));
        let elements = self.plain_elements(ast.at(site.arguments, 1));
        let elements = elements.map(|elements| self.fill_frame_with_elements(elements));
        let lazy = self.lazy_arguments(ast.at(site.arguments, 1));
        if elements.is_none() && lazy.is_none() {
            self.expr(ast.at(site.arguments, 1), Dest::Temp(list));
        }
        let new_target = match ast.get(site.arguments, 2) {
            Some(third) => self.expr(third, Dest::Temp(real.argument(2))),
            None => target.into(),
        };
        self.before_call(site);
        let (candidate, general, done) =
            (self.asm().label(), self.asm().label(), self.asm().label());
        let builtin = self.link_time(LinkTimeConstant::REFLECT_CONSTRUCT);
        self.asm().jump_if_builtin(method, builtin, candidate);
        self.asm().bind_loop_head(general);
        if let Some(elements) = elements {
            self.array_of_frame(list, elements);
        } else if let Some(lazy) = lazy {
            self.resolve_for_use(lazy.name, site.start);
            self.asm().mov(list, lazy.register);
        }
        let arguments = Arguments::InFrame(real);
        self.emit_call(result, method.into(), reflect, arguments, site.tail);
        self.asm().jump(done);
        self.asm().bind(candidate);
        let scratch = self.temp();
        for value in [target.into(), new_target]
            .into_iter()
            .take(count as usize - 1)
        {
            self.asm().is_constructor(scratch, value);
            self.asm().jump_if_false(scratch, general);
        }
        match elements {
            Some(frame) => {
                let count = frame.arguments + 1;
                (self.asm()).construct(result, target, new_target, count, frame.offset);
            }
            None => {
                if lazy.is_none() {
                    self.asm().jump_if_not_object(list, general);
                }
                let (list, skip) = lazy.map_or((list, 0), |it| (it.register, it.skip));
                self.asm().to_argument_list(scratch, list);
                (self.asm()).construct_varargs(result, target, new_target, scratch, skip);
            }
        }
        self.asm().bind(done);
        Some(result.into())
    }
}
