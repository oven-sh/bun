//! Checks the types of operands (WebAssembly Core, appendix "Validation Algorithm").

/// Builds an error away from the code that runs. What it names is copied.
macro_rules! fail {
    ($kind:ident, $($reason:tt)*) => {
        return Err($crate::validate::cold(move || {
            $crate::validate::$kind(format_args!($($reason)*))
        }))
    };
}

macro_rules! ensure {
    ($condition:expr, $($error:tt)*) => {
        if !$condition {
            fail!($($error)*);
        }
    };
}

mod constant;
mod control;
mod locals;
mod memory;
mod numeric;
mod reference;
mod vector;

use core::fmt::Arguments;
use core::mem;

pub(crate) use self::constant::validate_const_expr;
use self::locals::Locals;
use crate::alloc::TryPush;
use crate::decode::{Check, Context, Decoder, Mode, STRUCT_SET, VectorOp, opcodes_at};
use crate::error::{Error, Missing};
use crate::index::{CodeIndex, TypeIndex};
use crate::limits::{MAX_LOCALS, MAX_OPERAND_STACK_HEIGHT};
use crate::module::{Features, FunctionFacts, FunctionFlags, ModuleHeader};
use crate::opcode::{GC_PREFIX, TRY_TABLE, VECTOR_PREFIX};
use crate::reader::Reader;
use crate::types::{BlockType, HeapType, RefType, Types, ValType};
use crate::visitor::Visit;

type Checked = Result<(), Error>;

#[cold]
#[inline(never)]
fn cold(make: impl FnOnce() -> Error) -> Error {
    make()
}

fn validation(reason: Arguments<'_>) -> Error {
    Error::validation(reason)
}

fn parse(reason: Arguments<'_>) -> Error {
    Error::parse(0, reason).lacking(Missing::OffsetAfterInstruction)
}

fn named(reason: Arguments<'_>) -> Error {
    Error::validation(reason).lacking(Missing::OpcodeName)
}

fn numbered(reason: Arguments<'_>) -> Error {
    Error::validation(reason).lacking(Missing::SecondOpcodeNumber)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FrameKind {
    Body,
    Constant,
    Block,
    Loop,
    If,
    Else,
    Try,
    Catch,
    CatchAll,
}

#[derive(Clone, Copy)]
struct Frame {
    ty: BlockType,
    /// The height of the operand stack below the parameters.
    base: u32,
    initialized_height: u32,
    /// The number of the last `br_table` that checked this label.
    checked_by: u32,
    kind: FrameKind,
    outer_is_unreachable: bool,
}

/// Memory that the validation of one function leaves to the next.
#[derive(Default)]
pub struct Scratch {
    values: Vec<ValType>,
    frames: Vec<Frame>,
    locals: Locals,
}

/// The index is that of a function of the module.
pub fn validate_function(
    header: &ModuleHeader,
    code: CodeIndex,
    body: &[u8],
    scratch: &mut Scratch,
) -> Result<FunctionFacts, Error> {
    Validator::with(header, scratch, |validator| validator.function(code, body))
}

pub(crate) struct Validator<'a> {
    header: &'a ModuleHeader,
    /// Above the greatest height so far all are `NEVER_USED`.
    values: Vec<ValType>,
    height: usize,
    /// That of the innermost frame.
    base: u32,
    /// Whether the innermost frame has values of any type below those on the stack.
    is_unreachable: bool,
    frames: Vec<Frame>,
    locals: Locals,
    br_tables: u32,
    catch_depth: u32,
    max_catch_depth: u32,
    uses_simd: bool,
}

const NEVER_USED: ValType = ValType::NONE;
const RETAINED_LENGTH: usize = 1 << 14;

impl<'a> Validator<'a> {
    pub(crate) fn with<T>(
        header: &'a ModuleHeader,
        scratch: &mut Scratch,
        work: impl FnOnce(&mut Self) -> T,
    ) -> T {
        let Scratch {
            values,
            frames,
            locals,
        } = mem::take(scratch);
        let mut validator = Self {
            header,
            values,
            height: 0,
            base: 0,
            is_unreachable: false,
            frames,
            locals,
            br_tables: 0,
            catch_depth: 0,
            max_catch_depth: 0,
            uses_simd: false,
        };
        let result = work(&mut validator);
        if validator.values.len().max(validator.frames.capacity()) <= RETAINED_LENGTH {
            *scratch = Scratch {
                values: validator.values,
                frames: validator.frames,
                locals: validator.locals,
            };
        }
        result
    }

    pub(crate) fn function(
        &mut self,
        code: CodeIndex,
        body: &[u8],
    ) -> Result<FunctionFacts, Error> {
        let result = self.check_function(code, body);
        let max_stack_height = self.reset();
        match result {
            Ok(facts) => Ok(FunctionFacts {
                max_stack_height,
                ..facts
            }),
            Err(error) => Err(error.in_function(code)),
        }
    }

    fn check_function(&mut self, code: CodeIndex, body: &[u8]) -> Result<FunctionFacts, Error> {
        let ty = self.header.func_type_index(self.header.func_index(code));
        let mut reader = Reader::new(body, 0);
        self.uses_simd = self.types().signature_has_v128(ty);
        self.declare_locals(ty, &mut reader)?;
        let code_offset = reader.position() as u32;

        self.enter(FrameKind::Body, BlockType::Func(ty));
        let (end, cx) = self.run(body, reader.position())?;
        if end != body.len() {
            let reason = format_args!("function body size doesn't match the expected size");
            return Err(Error::parse(end, reason));
        }

        let mut flags = cx.flags;
        if self.uses_simd {
            flags |= FunctionFlags::USES_SIMD;
        }
        Ok(FunctionFacts {
            code_offset,
            local_count: self.locals.count(),
            max_stack_height: 0,
            max_catch_depth: self.max_catch_depth,
            call_count: cx.calls,
            loop_count: cx.loops,
            flags,
        })
    }

    /// Returns where the code ends.
    #[inline(never)]
    fn run<'b>(&mut self, bytes: &'b [u8], start: usize) -> Result<(usize, Context<'b>), Error>
    where
        'a: 'b,
    {
        let mut cx = Context::new(self.header);
        let mut decoder = Decoder::<Check>::new(Reader::new(bytes, start), &mut cx);
        match decoder.run(self) {
            Ok(()) => Ok((decoder.reader.position(), cx)),
            Err(error) => Err(self.first_error(error, bytes, cx)),
        }
    }

    /// Some instructions have operands checked before all their immediates are read.
    #[cold]
    fn first_error<'b>(&mut self, mut error: Error, bytes: &'b [u8], mut cx: Context<'b>) -> Error {
        let (Some(Missing::OperandCheck(start)), 0) = (error.take_missing(), cx.dead) else {
            return error;
        };
        let (first, second, immediates) = opcodes_at(bytes, start);
        let mut decoder = Decoder::<Check>::new(Reader::new(bytes, immediates), &mut cx);
        let has_simd = self.header.features.contains(Features::SIMD);
        let mut lane_access = |name, size| {
            self.pop_lane_vector(name)?;
            let arg = decoder.vector_mem_arg(size);
            arg.map_or(Ok(()), |arg| self.pop_vector_address(arg))
        };
        let earlier = match (first, VectorOp::from_number(second)) {
            (VECTOR_PREFIX, _) if !has_simd => Ok(()),
            (VECTOR_PREFIX, VectorOp::LoadLane(size)) => lane_access("load_lane", size),
            (VECTOR_PREFIX, VectorOp::StoreLane(size)) => lane_access("store_lane", size),
            (VECTOR_PREFIX, VectorOp::Store) => self.pop_stored_vector(),
            (GC_PREFIX, _) if second == STRUCT_SET => self.pop_early("struct.set value").map(drop),
            (TRY_TABLE, _) => match decoder.block_type(first) {
                Ok(BlockType::Func(index)) => self.check_block_params(index).map(drop),
                _ => Ok(()),
            },
            _ => Ok(()),
        };
        match earlier {
            Ok(()) => error,
            Err(earlier) => Check::complete(earlier, bytes, start, decoder.reader.position()),
        }
    }

    fn declare_locals(&mut self, ty: TypeIndex, reader: &mut Reader<'_>) -> Checked {
        let params = self.types().func_type(ty).params;
        let error = |reader: &Reader<'_>, reason: Arguments<'_>| {
            Err(Error::parse(reader.position(), reason))
        };
        let Some(groups) = reader.u32() else {
            return error(reader, format_args!("can't get local groups count"));
        };
        self.locals.start(params, reader.remaining());
        for i in 0..groups {
            let Some(count) = reader.u32() else {
                let reason = format_args!("can't get Function's number of locals in group {i}");
                return error(reader, reason);
            };
            let total = u64::from(self.locals.count()) + u64::from(count);
            if total > MAX_LOCALS.into() {
                let reason = format_args!(
                    "Function's number of locals is too big {total} maximum {MAX_LOCALS}"
                );
                return error(reader, reason);
            }
            let Some(ty) = self.header.value_type(reader) else {
                let reason = format_args!("can't get Function local's type in group {i}");
                return error(reader, reason);
            };
            self.uses_simd |= ty == ValType::V128;
            self.locals.declare(count, ty);
        }
        Ok(())
    }

    fn enter(&mut self, kind: FrameKind, ty: BlockType) {
        self.frames.push(Frame {
            ty,
            base: 0,
            initialized_height: 0,
            checked_by: 0,
            kind,
            outer_is_unreachable: false,
        });
    }

    /// Returns the greatest height that the operand stack had.
    fn reset(&mut self) -> u32 {
        let mut max_height = 0;
        for value in &mut self.values {
            if mem::replace(value, NEVER_USED) == NEVER_USED {
                break;
            }
            max_height += 1;
        }
        self.height = 0;
        self.base = 0;
        self.is_unreachable = false;
        self.frames.clear();
        self.locals.forget_initializations(0);
        self.br_tables = 0;
        self.catch_depth = 0;
        self.max_catch_depth = 0;
        max_height
    }

    #[inline(always)]
    fn types(&self) -> &'a Types {
        &self.header.types
    }

    #[inline(always)]
    fn fits(&self, actual: impl Into<ValType>, expected: impl Into<ValType>) -> bool {
        self.types().is_subtype(actual.into(), expected.into())
    }

    /// The number of values that the innermost frame has on the stack.
    #[inline(always)]
    fn available(&self) -> usize {
        self.height - self.base as usize
    }

    #[inline(always)]
    fn has(&self, count: usize) -> bool {
        self.available() >= count || self.is_unreachable
    }

    #[inline(always)]
    fn push(&mut self, ty: impl Into<ValType>) -> Checked {
        let height = self.height;
        match self.values.get_mut(height) {
            Some(slot) => {
                *slot = ty.into();
                self.height = height + 1;
                Ok(())
            }
            None => self.push_many(&[ty.into()]),
        }
    }

    #[inline]
    fn push_all(&mut self, types: &[ValType]) -> Checked {
        match types {
            [] => Ok(()),
            &[ty] => self.push(ty),
            _ => self.push_many(types),
        }
    }

    #[inline(never)]
    fn push_many(&mut self, types: &[ValType]) -> Checked {
        if self.values.len() - self.height < types.len() {
            self.grow(types.len())?;
        }
        self.values[self.height..][..types.len()].copy_from_slice(types);
        self.height += types.len();
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn grow(&mut self, count: usize) -> Checked {
        let (needed, limit) = (self.height + count, MAX_OPERAND_STACK_HEIGHT as usize);
        let length = needed.max(self.values.len() * 2).max(64).min(limit);
        ensure!(
            needed <= limit
                && self
                    .values
                    .try_reserve_exact(length - self.values.len())
                    .is_ok(),
            parse,
            "can't allocate enough memory for {needed} values on the expression stack"
        );
        self.values.resize(length, NEVER_USED);
        Ok(())
    }

    /// For instructions that leave a value whose type does not tell that it is no vector.
    #[inline(always)]
    fn push_loaded(&mut self, ty: ValType) -> Checked {
        self.uses_simd |= ty == ValType::V128;
        self.push(ty)
    }

    #[inline(always)]
    fn pop(&mut self, what: &'static str) -> Result<ValType, Error> {
        if self.height > self.base as usize {
            self.height -= 1;
            return Ok(self.values[self.height]);
        }
        ensure!(
            self.is_unreachable,
            parse,
            "can't pop empty stack in {what}"
        );
        Ok(ValType::UNKNOWN)
    }

    /// For the instructions whose first operand is missed before their immediates are read.
    fn pop_early(&mut self, what: &'static str) -> Result<ValType, Error> {
        self.pop(what)
            .map_err(|error| error.lacking(Missing::OffsetAfterOpcode))
    }

    /// The last is the top.
    #[inline(always)]
    fn pop_array<const N: usize>(&mut self, what: &'static str) -> Result<[ValType; N], Error> {
        let mut values = [ValType::UNKNOWN; N];
        for value in values.iter_mut().rev() {
            *value = self.pop(what)?;
        }
        Ok(values)
    }

    fn pop_ref(&mut self, name: &'static str, role: &'static str) -> Result<RefType, Error> {
        let ty = self.pop(name)?;
        match ty.as_ref() {
            Some(reference) => Ok(reference),
            None if ty == ValType::UNKNOWN => Ok(HeapType::UNKNOWN.non_null()),
            None => fail!(
                validation,
                "{name}{role} to type {ty} expected a reference type"
            ),
        }
    }

    /// The top `N` values, if the innermost frame has them.
    #[inline(always)]
    fn top<const N: usize>(&mut self) -> Option<&mut [ValType; N]> {
        if self.height < self.base as usize + N {
            return None;
        }
        self.values.get_mut(..self.height)?.last_chunk_mut()
    }

    /// Those of the top `count` values that are there.
    #[inline]
    fn top_slice(&self, count: usize) -> &[ValType] {
        &self.values[self.height - count.min(self.available())..self.height]
    }

    #[inline(always)]
    fn top_is(&self, types: &[ValType]) -> bool {
        let top = self.top_slice(types.len());
        top.len() == types.len()
            && if types.len() <= 8 {
                top.iter().zip(types).all(|(a, b)| a == b)
            } else {
                ValType::all_equal(top, types)
            }
    }

    /// Pairs those of the top values that are there with what is expected and its index.
    fn operands<'b>(
        &'b self,
        expected: &'b [ValType],
    ) -> impl DoubleEndedIterator<Item = (usize, ValType, ValType)> + 'b {
        let actual = self.top_slice(expected.len());
        let missing = expected.len() - actual.len();
        let pairs = actual.iter().zip(&expected[missing..]).enumerate();
        pairs.map(move |(i, (&actual, &expected))| (missing + i, actual, expected))
    }

    #[inline]
    fn discard(&mut self, count: usize) {
        self.height -= count.min(self.available());
    }

    fn replace_top(&mut self, types: &[ValType]) -> Checked {
        self.discard(types.len());
        self.push_all(types)
    }

    #[inline(always)]
    fn set_unreachable(&mut self) -> Checked {
        self.height = self.base as usize;
        self.is_unreachable = true;
        Ok(())
    }

    /// The parameters are on the stack.
    #[inline(always)]
    fn push_frame(&mut self, kind: FrameKind, ty: BlockType, params: usize) -> Checked {
        self.base = (self.height - params) as u32;
        let frame = Frame {
            ty,
            base: self.base,
            initialized_height: self.locals.initialized_height(),
            checked_by: 0,
            kind,
            outer_is_unreachable: mem::replace(&mut self.is_unreachable, false),
        };
        ensure!(
            self.frames.try_push(frame).is_ok(),
            parse,
            "can't allocate enough memory for the control stack"
        );
        Ok(())
    }
}

impl Visit for Validator<'_> {
    type Error = Error;

    fn unhandled(&mut self) -> Checked {
        unreachable!()
    }
}

/// For a type that has no subtypes.
#[inline(always)]
fn is(actual: ValType, expected: ValType) -> bool {
    actual == expected || actual == ValType::UNKNOWN
}
