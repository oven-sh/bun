//! What built-ins write as calls of `@name` and get as instructions.

use bun_engine_syntax::Name;
use bun_engine_syntax::ast::{Expr, ExprId, ExprKind, List};
use bun_engine_text::{PropertyName, StringRef, find_private_name};

use super::control::Closer;
use super::operator::Branch;
use super::{Dest, Failure, Generator};
use crate::code::HandlerKind;
use crate::constant::Constant;
use crate::host::BuiltinValue;
use crate::operand::{CellType, ErrorKind, IdentifierIndex, Operand, PutFlags, Register};

#[derive(Clone, Copy)]
pub(super) enum Builtin {
    Intrinsic(Intrinsic),
    Value(Operand),
}

#[derive(Clone, Copy)]
pub(super) enum Intrinsic {
    Argument,
    ArgumentCount,
    ArgumentsFrom,
    ArrayPush,
    Assert,
    CreatePromise,
    GetByIdDirect {
        is_private: bool,
    },
    GetByValWithThis,
    GetInternalField,
    GetPrototypeOf,
    HasShapeWithFlags(u32),
    IfAbruptCloseIterator,
    IsCallable,
    IsCellOfType(CellType),
    IsConstructor,
    IsNullish,
    IsObject,
    /// Only as what `for`-`of` iterates over.
    IterableWithMethod,
    IteratorClose,
    IteratorNext,
    NewArrayWithSize,
    NewArrayWithSpecies,
    NewPromise,
    PutByIdDirect {
        is_private: bool,
    },
    PutByValDirect,
    PutByValWithThis {
        is_strict: bool,
    },
    PutInternalField,
    ResumeGenerator,
    Throw(ErrorKind),
    ToNumber,
    ToObject,
    ToPropertyKey,
    ToString,
    ToThis,
}

fn intrinsic_named(name: &[u8]) -> Option<Intrinsic> {
    Some(match name {
        b"argument" => Intrinsic::Argument,
        b"argumentCount" => Intrinsic::ArgumentCount,
        b"argumentsFrom" => Intrinsic::ArgumentsFrom,
        b"arrayPush" => Intrinsic::ArrayPush,
        b"assert" => Intrinsic::Assert,
        b"createPromise" => Intrinsic::CreatePromise,
        b"getByIdDirect" => Intrinsic::GetByIdDirect { is_private: false },
        b"getByIdDirectPrivate" => Intrinsic::GetByIdDirect { is_private: true },
        b"getByValWithThis" => Intrinsic::GetByValWithThis,
        b"getInternalField" | b"getProxyInternalField" => Intrinsic::GetInternalField,
        b"getPrototypeOf" => Intrinsic::GetPrototypeOf,
        b"ifAbruptCloseIterator" => Intrinsic::IfAbruptCloseIterator,
        b"isCallable" => Intrinsic::IsCallable,
        b"isConstructor" => Intrinsic::IsConstructor,
        b"isObject" => Intrinsic::IsObject,
        b"isUndefinedOrNull" => Intrinsic::IsNullish,
        b"iterableWithMethod" => Intrinsic::IterableWithMethod,
        b"iteratorGenericClose" => Intrinsic::IteratorClose,
        b"iteratorGenericNext" => Intrinsic::IteratorNext,
        b"newArrayWithSize" => Intrinsic::NewArrayWithSize,
        b"newArrayWithSpecies" => Intrinsic::NewArrayWithSpecies,
        b"newPromise" => Intrinsic::NewPromise,
        b"putByIdDirect" => Intrinsic::PutByIdDirect { is_private: false },
        b"putByIdDirectPrivate" => Intrinsic::PutByIdDirect { is_private: true },
        b"putByValDirect" => Intrinsic::PutByValDirect,
        b"putByValWithThisSloppy" => Intrinsic::PutByValWithThis { is_strict: false },
        b"putByValWithThisStrict" => Intrinsic::PutByValWithThis { is_strict: true },
        b"putInternalField" => Intrinsic::PutInternalField,
        b"resumeGenerator" => Intrinsic::ResumeGenerator,
        b"throwOutOfMemoryError" => Intrinsic::Throw(ErrorKind::OutOfMemory),
        b"throwRangeError" => Intrinsic::Throw(ErrorKind::RangeError),
        b"throwTypeError" => Intrinsic::Throw(ErrorKind::TypeError),
        b"toNumber" => Intrinsic::ToNumber,
        b"toObject" => Intrinsic::ToObject,
        b"toPropertyKey" => Intrinsic::ToPropertyKey,
        b"toString" => Intrinsic::ToString,
        b"toThis" => Intrinsic::ToThis,
        _ => return None,
    })
}

impl Generator<'_> {
    pub(super) fn find_builtin(&mut self, name: PropertyName<'_>) -> Option<Builtin> {
        if let bun_engine_text::Text::Latin1(text) = name.text() {
            match text {
                b"undefined" => return Some(Builtin::Value(self.undefined())),
                b"Infinity" => return Some(Builtin::Value(self.double(f64::INFINITY))),
                _ => {}
            }
            if let Some(intrinsic) = intrinsic_named(text) {
                return Some(Builtin::Intrinsic(intrinsic));
            }
        }
        Some(match self.host.builtin_value(name)? {
            BuiltinValue::Int32(value) => Builtin::Value(self.int32(value)),
            BuiltinValue::Double(value) => Builtin::Value(self.double(value)),
            BuiltinValue::LinkTime(value) => Builtin::Value(self.link_time(value)),
            BuiltinValue::CellTest(it) => Builtin::Intrinsic(Intrinsic::IsCellOfType(it)),
            BuiltinValue::ShapeFlagsTest(it) => {
                Builtin::Intrinsic(Intrinsic::HasShapeWithFlags(it))
            }
        })
    }

    fn operand(&mut self, arguments: List<ExprId>, index: u32) -> Operand {
        match self.ast.get(arguments, index) {
            Some(argument) => self.key_expr(argument, false),
            None => self.undefined(),
        }
    }

    fn value(&mut self, arguments: List<ExprId>, index: u32) -> Operand {
        match self.ast.get(arguments, index) {
            Some(argument) => self.expr(argument, Dest::Any),
            None => self.undefined(),
        }
    }

    #[cold]
    fn misuse(&mut self, node: &Expr) {
        let text = self
            .text
            .slice(node.start as usize..node.start as usize + 1);
        self.fail(Failure::UnknownBuiltinName(StringRef::from_text(text)));
    }

    fn immediate(&mut self, node: &Expr, arguments: List<ExprId>, index: u32) -> u32 {
        let value = self.value(arguments, index);
        if let Some(&Constant::Int32(value @ 0..)) = self.constant_of(value) {
            return value as u32;
        }
        self.misuse(node);
        0
    }

    fn named(
        &mut self,
        node: &Expr,
        arguments: List<ExprId>,
        index: u32,
        is_private: bool,
    ) -> IdentifierIndex {
        let argument = self.ast.get(arguments, index).map(|it| self.ast[it].kind);
        let Some(ExprKind::String(name)) = argument else {
            self.misuse(node);
            return self.identifier(Name::EMPTY);
        };
        if !is_private {
            return self.identifier(name);
        }
        let text = self.text_of(name);
        if let Some(symbol) = find_private_name(text, text.hash()) {
            return self.symbol_identifier(symbol);
        }
        match self.host.private_name(text) {
            Some(symbol) => self.symbol_identifier(symbol.name()),
            None => {
                self.fail(Failure::UnknownBuiltinName(StringRef::from_text(text)));
                self.identifier(name)
            }
        }
    }

    /// The arguments of `@iterableWithMethod(iterable, method)`.
    pub(super) fn iterable_with_method(&mut self, id: ExprId) -> Option<(ExprId, ExprId)> {
        if let ExprKind::Call {
            callee, arguments, ..
        } = self.ast[id].kind
            && let ExprKind::Identifier(name) = self.ast[callee].kind
            && let Some(Builtin::Intrinsic(Intrinsic::IterableWithMethod)) = self.builtin(name)
        {
            return self.ast.get(arguments, 0).zip(self.ast.get(arguments, 1));
        }
        None
    }

    /// False, having done nothing, unless the call is a test that an instruction can jump on.
    pub(super) fn intrinsic_condition(&mut self, node: &Expr, branch: Branch) -> bool {
        let ExprKind::Call {
            callee, arguments, ..
        } = node.kind
        else {
            return false;
        };
        let ExprKind::Identifier(name) = self.ast[callee].kind else {
            return false;
        };
        let Some(Builtin::Intrinsic(
            test @ (Intrinsic::IsObject | Intrinsic::IsNullish | Intrinsic::IsCellOfType(_)),
        )) = self.builtin(name)
        else {
            return false;
        };
        self.pause_before(node);
        let value = self.value(arguments, 0);
        let (outcome, target) = Self::branch_target(branch);
        let asm = self.asm();
        match (test, outcome) {
            (Intrinsic::IsCellOfType(it), true) => asm.jump_if_cell_of_type(value, it, target),
            (Intrinsic::IsCellOfType(it), false) => asm.jump_if_not_cell_of_type(value, it, target),
            (Intrinsic::IsObject, true) => asm.jump_if_object(value, target),
            (Intrinsic::IsObject, false) => asm.jump_if_not_object(value, target),
            (_, true) => asm.jump_if_nullish(value, target),
            (_, false) => asm.jump_if_not_nullish(value, target),
        }
        true
    }

    #[inline(never)]
    pub(super) fn intrinsic(
        &mut self,
        intrinsic: Intrinsic,
        node: &Expr,
        arguments: List<ExprId>,
        dst: Dest,
    ) -> Operand {
        let range = match node.kind {
            ExprKind::Call { divot, end, .. } => (divot, node.start, end),
            _ => (node.start, node.start, node.start),
        };
        let strict = self.is_strict;
        match intrinsic {
            Intrinsic::Assert => self.undefined_in(dst),
            Intrinsic::IterableWithMethod => {
                self.misuse(node);
                self.undefined_in(dst)
            }
            Intrinsic::Throw(kind) => {
                let message = match self.ast.get(arguments, 0) {
                    None => self.string(Name::EMPTY),
                    Some(message) => match self.ast[message].kind {
                        ExprKind::String(message) => self.string(message),
                        _ => {
                            let text = self.temp();
                            let message = self.expr(message, Dest::Prefer(text));
                            self.asm().to_string(text, message);
                            text.into()
                        }
                    },
                };
                self.asm().throw_error(kind, message);
                self.undefined()
            }
            Intrinsic::ArrayPush => {
                let (array, value) = (self.value(arguments, 0), self.value(arguments, 1));
                let length = self.temp();
                self.asm().get_length(length, array);
                self.asm().put_by_val_direct(array, length, value, strict);
                self.deliver(dst, value)
            }
            Intrinsic::PutByIdDirect { is_private } => {
                let base = self.value(arguments, 0);
                let name = self.named(node, arguments, 1, is_private);
                let value = self.value(arguments, 2);
                let mut flags = PutFlags::DIRECT;
                flags.set(PutFlags::STRICT, strict);
                self.note_property(base, name);
                self.asm().put_by_id(base, name, value, flags);
                self.deliver(dst, value)
            }
            Intrinsic::PutByValDirect => {
                let (base, key) = (self.value(arguments, 0), self.operand(arguments, 1));
                let value = self.value(arguments, 2);
                self.asm().put_by_val_direct(base, key, value, strict);
                self.deliver(dst, value)
            }
            Intrinsic::PutByValWithThis { is_strict } => {
                let (base, this) = (self.value(arguments, 0), self.value(arguments, 1));
                let (key, value) = (self.operand(arguments, 2), self.value(arguments, 3));
                (self.asm()).put_by_val_with_this(base, this, key, value, is_strict);
                self.undefined_in(dst)
            }
            Intrinsic::PutInternalField => {
                let base = self.value(arguments, 0);
                let index = self.immediate(node, arguments, 1);
                let value = self.value(arguments, 2);
                self.asm().put_internal_field(base, index, value);
                self.deliver(dst, value)
            }
            Intrinsic::IteratorClose => {
                let iterator = self.value(arguments, 0);
                self.close_generic_iterator(iterator, range, false);
                self.undefined_in(dst)
            }
            Intrinsic::IteratorNext => {
                let result = self.temp_dst(dst);
                let (next, iterator) = (self.value(arguments, 0), self.value(arguments, 1));
                let next = self.in_register(next);
                self.position(range.0, range.1, range.2);
                self.call_method(result, next, iterator, None);
                self.throw_unless_result(result);
                self.deliver(dst, result)
            }
            Intrinsic::IfAbruptCloseIterator => {
                self.close_if_abrupt(arguments, range);
                self.undefined_in(dst)
            }
            Intrinsic::ToThis => {
                let value = self.value(arguments, 0);
                self.deliver(dst, value)
            }
            _ => self
                .computing_intrinsic(intrinsic, node, arguments, dst)
                .into(),
        }
    }

    fn undefined_in(&mut self, dst: Dest) -> Operand {
        let undefined = self.undefined();
        self.deliver(dst, undefined)
    }

    /// Those that are one instruction with a result.
    fn computing_intrinsic(
        &mut self,
        intrinsic: Intrinsic,
        node: &Expr,
        arguments: List<ExprId>,
        dst: Dest,
    ) -> Register {
        let mark = self.top;
        let takes_value = !matches!(
            intrinsic,
            Intrinsic::Argument
                | Intrinsic::ArgumentCount
                | Intrinsic::ArgumentsFrom
                | Intrinsic::NewPromise
        );
        let first = if takes_value {
            self.value(arguments, 0)
        } else {
            Register::SCOPE.into()
        };
        let (second, third) = match intrinsic {
            Intrinsic::GetByValWithThis => (self.value(arguments, 1), self.operand(arguments, 2)),
            Intrinsic::ResumeGenerator => (self.value(arguments, 1), self.value(arguments, 2)),
            Intrinsic::NewArrayWithSpecies => (self.value(arguments, 1), first),
            _ => (first, first),
        };
        let top = core::mem::replace(&mut self.top, mark);
        let dst = self.final_dst(dst);
        match intrinsic {
            Intrinsic::Argument => {
                let index = self.immediate(node, arguments, 0);
                self.asm().get_argument(dst, index);
            }
            Intrinsic::ArgumentCount => self.asm().argument_count(dst),
            Intrinsic::ArgumentsFrom => {
                let skip = self.immediate(node, arguments, 0);
                self.asm().create_rest(dst, skip);
            }
            Intrinsic::NewPromise => self.asm().new_promise(dst),
            Intrinsic::CreatePromise => self.asm().create_promise(dst, first),
            Intrinsic::GetByIdDirect { is_private } => {
                let name = self.named(node, arguments, 1, is_private);
                self.asm().get_by_id_direct(dst, first, name);
            }
            Intrinsic::GetByValWithThis => {
                self.asm().get_by_val_with_this(dst, first, second, third);
            }
            Intrinsic::GetInternalField => {
                let index = self.immediate(node, arguments, 1);
                self.asm().get_internal_field(dst, first, index);
            }
            Intrinsic::GetPrototypeOf => self.asm().get_prototype_of(dst, first),
            Intrinsic::HasShapeWithFlags(flags) => {
                self.asm().has_shape_with_flags(dst, first, flags);
            }
            Intrinsic::IsCallable => self.asm().is_callable(dst, first),
            Intrinsic::IsCellOfType(it) => self.asm().is_cell_of_type(dst, first, it),
            Intrinsic::IsConstructor => self.asm().is_constructor(dst, first),
            Intrinsic::IsNullish => self.asm().is_nullish(dst, first),
            Intrinsic::IsObject => self.asm().is_object(dst, first),
            Intrinsic::NewArrayWithSize => self.asm().new_array_with_size(dst, first),
            Intrinsic::NewArrayWithSpecies => {
                self.asm().new_array_with_species(dst, first, second);
            }
            Intrinsic::ResumeGenerator => {
                self.top = self.top.max(top);
                let frame = self.frame(2).offset();
                (self.asm()).resume_generator(dst, first, second, third, frame);
            }
            Intrinsic::ToNumber => self.asm().to_number(dst, first),
            Intrinsic::ToObject => {
                let message = match arguments.len() {
                    1 => self.identifier(Name::EMPTY),
                    _ => self.named(node, arguments, 1, false),
                };
                self.asm().to_object(dst, first, message);
            }
            Intrinsic::ToPropertyKey => self.asm().to_property_key(dst, first),
            _ => self.asm().to_string(dst, first),
        }
        dst
    }

    fn close_if_abrupt(&mut self, arguments: List<ExprId>, range: (u32, u32, u32)) {
        let iterator = self.value(arguments, 0);
        let [failed, rethrow, done] = core::array::from_fn(|_| self.asm().label());
        let handler = self.guard_iterator(Closer::Object(iterator), range);
        if let Some(step) = self.ast.get(arguments, 1) {
            self.effect(step);
        }
        self.asm().pop_try();
        self.asm().jump(done);
        self.close_iterator_on_exits();
        let (exception, scratch) = (self.temp(), self.temps(2));
        self.asm().bind(handler);
        self.asm().catch(exception, scratch);
        self.asm().push_try(failed, HandlerKind::SynthesizedCatch);
        self.close_generic_iterator(iterator, range, false);
        self.asm().pop_try();
        self.asm().jump(rethrow);
        self.asm().bind(failed);
        self.asm().catch(scratch, scratch.nth(1));
        self.asm().bind(rethrow);
        self.asm().rethrow(exception);
        self.asm().bind(done);
    }
}
