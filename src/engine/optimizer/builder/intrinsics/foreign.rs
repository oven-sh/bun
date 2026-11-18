//! Native functions of which more is known than their address.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{State, Type, Unary, Value as Ssa};
use bun_engine_ffi::{FfiFunction, NativeType, Representation};
use bun_engine_vm::{ElementType, SpeculatedType as T, ViewMode};
use smallvec::SmallVec;

use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::graph::{AS_INDEX, ExitKind, Kind};

const VIEW: T = T::TYPED_ARRAY.union(T::DATA_VIEW);

/// How a value becomes an argument.
#[derive(Clone, Copy)]
enum Pass {
    AsItIs,
    Truth,
    /// As it would be stored.
    Element(ElementType),
    WholeNumber,
    Vector,
    LengthOfBytes,
}

fn element_like(ty: NativeType) -> Option<ElementType> {
    Some(match ty {
        NativeType::Char | NativeType::Int8 => ElementType::Int8,
        NativeType::Uint8 => ElementType::Uint8,
        NativeType::Int16 => ElementType::Int16,
        NativeType::Uint16 => ElementType::Uint16,
        NativeType::Int32 => ElementType::Int32,
        NativeType::Uint32 => ElementType::Uint32,
        NativeType::Float => ElementType::Float32,
        NativeType::Double => ElementType::Float64,
        _ => return None,
    })
}

impl Builder<'_> {
    pub(super) fn call_clock(&mut self, site: &CallSite<'_>) -> Option<Ssa> {
        let operands = self.native_function(site)?;
        Some(self.profiled_node(Kind::CallClock, &operands, 0, T::REAL_DOUBLE))
    }

    fn way_to_pass(&self, to: NativeType, value: Ssa) -> Option<Pass> {
        let is_likely = |ty| self.all_expected(&[value], ty);
        let is_whole = is_likely(T::BOXED_NUMBER) && !self.has_exited(ExitKind::NotAnInteger);
        Some(match to {
            NativeType::Value => Pass::AsItIs,
            NativeType::Bool => Pass::Truth,
            NativeType::Buffer => is_likely(VIEW).then_some(Pass::Vector)?,
            NativeType::BufferLength => is_likely(T::UINT8_ARRAY).then_some(Pass::LengthOfBytes)?,
            NativeType::Pointer | NativeType::CString | NativeType::Function if is_likely(VIEW) => {
                Pass::Vector
            }
            _ if to.representation().size() == Some(Size::S64) && to != NativeType::Double => {
                if is_likely(T::BIGINT) {
                    Pass::Element(ElementType::BigInt64)
                } else {
                    is_whole.then_some(Pass::WholeNumber)?
                }
            }
            _ => Pass::Element(element_like(to).filter(|&it| self.may_become_element(it, value))?),
        })
    }

    /// Of an I32, within it.
    fn extend_low_bits(&mut self, bits: Ssa, size: Size, sign: Sign) -> Ssa {
        match (size, sign) {
            (Size::S32, _) => bits,
            (_, Sign::Signed) => self.ir().unary(Unary::SignExtend(size), bits),
            (_, Sign::Unsigned) => self.ir().and(bits, (1 << size.bits()) - 1),
        }
    }

    fn pass_to_foreign(&mut self, how: Pass, to: NativeType, value: Ssa) -> Ssa {
        let root = self.graph.root(value);
        match how {
            Pass::AsItIs => root,
            Pass::Truth => {
                let truth = self.to_boolean(value);
                self.ir().zero_extend(truth)
            }
            Pass::Element(of) => {
                let element = self.to_element(of, value);
                match to.representation() {
                    Representation::Integer(size, sign) if size < Size::S64 => {
                        let bits = self.extend_low_bits(element, size, sign);
                        self.ir().convert(Unary::Widen(sign), Type::I64, bits)
                    }
                    _ => element,
                }
            }
            Pass::WholeNumber => self.node(Kind::AsInt52, &[root], AS_INDEX),
            Pass::Vector => {
                let view = self.check_type_or(value, VIEW, ExitKind::ExoticObject);
                self.vector(view)
            }
            Pass::LengthOfBytes => {
                let view = self.check_type_or(value, T::UINT8_ARRAY, ExitKind::ExoticObject);
                let can_change = self.mode_has(view, ViewMode::RESIZABLE_OR_GROWABLE);
                self.exit_if(can_change, ExitKind::ExoticObject);
                self.known_length(view)
            }
        }
    }

    /// Does not exit.
    fn box_foreign_result(&mut self, from: NativeType, result: Ssa, metadata: u32) -> Ssa {
        match (from, from.representation()) {
            (_, Representation::Nothing) => self.undefined(),
            (_, Representation::Float(_)) => {
                let expected = T::REAL_DOUBLE | self.prediction_at(metadata) & T::PURE_NAN;
                self.profiled_node(Kind::BoxDouble, &[result], 0, expected)
            }
            (_, Representation::Bool) => {
                let byte = self.ir().and(result, 0xff);
                let truth = self.ir().is_not_zero(byte);
                self.box_boolean(truth)
            }
            (NativeType::Uint32, _) => {
                let number = self.ir().and(result, i64::from(u32::MAX));
                let is_large = self.prediction_at(metadata).intersects(T::BOXED_DOUBLE);
                let expected = if is_large {
                    T::INT32 | T::INT52
                } else {
                    T::INT32
                };
                self.profiled_node(Kind::BoxInt52, &[number], 0, expected)
            }
            (NativeType::Int64 | NativeType::Uint64, Representation::Integer(_, sign)) => {
                self.bigint_from_bits(result, sign)
            }
            (NativeType::Value, _) => {
                let (is_empty, undefined) = (self.ir().is_zero(result), self.undefined());
                let value = self.ir().select(is_empty, undefined, result);
                self.graph.declare(value, T::HEAP_TOP);
                self.profile_result(value, metadata)
            }
            (_, Representation::Integer(Size::S64, _)) => {
                let value = self.node(Kind::BoxForeignInteger, &[result], from as u32);
                self.profile_result(value, metadata)
            }
            (_, Representation::Integer(size, sign)) => {
                let bits = self.ir().wrap(result);
                let number = self.extend_low_bits(bits, size, sign);
                self.box_int32(number)
            }
        }
    }

    pub(super) fn call_foreign(&mut self, site: &CallSite<'_>) -> Option<Ssa> {
        let function = self.constant_cell::<FfiFunction>(site.callee)?;
        let signature = function.signature();
        let (types, result) = (signature.arguments(), signature.result());
        let values = site.arguments[1..].get(..types.len())?;
        if result == NativeType::CString || !signature.layout().has_only_words_on_stack {
            return None;
        }
        let ways: Option<SmallVec<[Pass; 8]>> = (types.iter().zip(values))
            .map(|(&to, &value)| self.way_to_pass(to, value))
            .collect();
        let ways = ways?;
        let mut operands: SmallVec<[Ssa; 8]> = smallvec::smallvec![self.word(function.target())];
        for ((&how, &to), &value) in ways.iter().zip(types).zip(values) {
            operands.push(self.pass_to_foreign(how, to, value));
        }
        let kind = match result.representation() {
            Representation::Float(_) => Kind::CallForeignForFloat,
            _ => Kind::CallForeign,
        };
        self.graph.signatures.push(signature);
        let returned = self.node(kind, &operands, self.graph.signatures.len() as u32 - 1);
        let lent =
            (ways.iter().zip(values)).filter(|it| matches!(it.0, Pass::AsItIs | Pass::Vector));
        for (_, &value) in lent {
            self.insert_node(Kind::KeepAlive, &[self.graph.root(value)], 0, State::NONE);
        }
        Some(self.box_foreign_result(result, returned, site.metadata))
    }
}
