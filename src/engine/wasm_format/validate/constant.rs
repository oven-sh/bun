//! Constant expressions.

use bun_engine_asm::Width;

use super::{Checked, FrameKind, Scratch, Validator};
use crate::alloc::TryPush;
use crate::decode::{Check, Context, Decoder, NO_OPCODE};
use crate::error::Error;
use crate::index::{FuncIndex, GlobalIndex, TypeIndex};
use crate::module::ModuleHeader;
use crate::ops::{Flow, IntBinaryOp};
use crate::reader::Reader;
use crate::types::{BlockType, HeapType, ValType};
use crate::visitor::{
    Visit, VisitControl, VisitMemory, VisitNumeric, VisitReference, VisitVariable, VisitVector,
};

/// `bytes` start with the expression, at `offset` in the module. Adds the functions that it names to `funcs` and
/// returns its length.
pub(crate) fn validate_const_expr(
    header: &ModuleHeader,
    bytes: &[u8],
    offset: usize,
    expected: ValType,
    scratch: &mut Scratch,
    funcs: &mut Vec<FuncIndex>,
) -> Result<usize, Error> {
    Validator::with(header, scratch, |validator| {
        validator.start_constant(expected);
        let mut cx = Context::new(header);
        let mut decoder = Decoder::<Check>::new(Reader::new(bytes, 0), &mut cx);
        let mut constant = Constant {
            validator,
            funcs,
            rejected: None,
            has_nop: false,
        };
        let result = decoder.run(&mut constant);
        let (rejected, has_nop) = (constant.rejected, constant.has_nop);
        let end = decoder.reader.position();
        validator.reset();

        let not_constant = || {
            let reason = format_args!("Invalid instruction for constant expression");
            Error::parse(offset + end, reason)
        };
        match (result, rejected) {
            (Ok(()), _) if has_nop => Err(not_constant()),
            (Ok(()), _) => Ok(end),
            (Err(mut error), None) => {
                error.take_missing();
                Err(validator.error_anywhere(bytes, expected).unwrap_or(error))
            }
            (Err(_), Some(Rejected::MutableGlobal(index))) => Err(Error::parse(
                offset + end,
                format_args!("get_global import kind index {index} is mutable "),
            )),
            (Err(_), Some(Rejected::Instruction)) => Err(validator
                .error_anywhere(&bytes[..end], expected)
                .unwrap_or_else(not_constant)),
        }
    })
}

impl Validator<'_> {
    fn start_constant(&mut self, expected: ValType) {
        self.locals.start(&[], 0);
        self.enter(FrameKind::Constant, BlockType::Value(expected));
    }

    /// What would be wrong with the last instruction in a function comes before its not being constant.
    #[cold]
    fn error_anywhere(&mut self, bytes: &[u8], expected: ValType) -> Option<Error> {
        self.start_constant(expected);
        let result = self.run(bytes, 0);
        self.reset();
        result.err().filter(|error| error.reason() != NO_OPCODE)
    }
}

#[derive(Clone, Copy)]
enum Rejected {
    Instruction,
    MutableGlobal(GlobalIndex),
}

struct Constant<'v, 'a> {
    validator: &'v mut Validator<'a>,
    funcs: &'v mut Vec<FuncIndex>,
    rejected: Option<Rejected>,
    /// Reported at the end.
    has_nop: bool,
}

impl Constant<'_, '_> {
    fn reject(&mut self, rejected: Rejected) -> Checked {
        self.rejected = Some(rejected);
        Err(Error::validation(format_args!("")))
    }
}

macro_rules! forward {
    ($($name:ident($($argument:ident: $type:ty),*);)*) => {
        $(fn $name(&mut self, $($argument: $type),*) -> Checked {
            self.validator.$name($($argument),*)
        })*
    };
}

impl Visit for Constant<'_, '_> {
    type Error = Error;

    fn unhandled(&mut self) -> Checked {
        self.reject(Rejected::Instruction)
    }
}

impl VisitControl for Constant<'_, '_> {
    fn nop(&mut self) -> Checked {
        self.has_nop = true;
        Ok(())
    }

    forward! {
        end(flow: Flow);
    }
}

impl VisitVariable for Constant<'_, '_> {
    fn global_get(&mut self, global: GlobalIndex) -> Checked {
        if self.validator.header.global(global).mutable {
            return self.reject(Rejected::MutableGlobal(global));
        }
        self.validator.global_get(global)
    }
}

impl VisitNumeric for Constant<'_, '_> {
    fn int_binary(&mut self, width: Width, op: IntBinaryOp) -> Checked {
        match op {
            IntBinaryOp::Add | IntBinaryOp::Sub | IntBinaryOp::Mul => {
                self.validator.int_binary(width, op)
            }
            IntBinaryOp::And | IntBinaryOp::Or | IntBinaryOp::Xor => self.unhandled(),
        }
    }

    forward! {
        i32_const(value: i32);
        i64_const(value: i64);
        f32_const(bits: u32);
        f64_const(bits: u64);
    }
}

impl VisitMemory for Constant<'_, '_> {}

impl VisitReference for Constant<'_, '_> {
    fn ref_func(&mut self, func: FuncIndex) -> Checked {
        ensure!(
            self.funcs.try_push(func).is_ok(),
            parse,
            "could not allocate memory for init expr"
        );
        self.validator.ref_func(func)
    }

    forward! {
        ref_null(ty: HeapType);
        ref_i31();
        any_convert_extern();
        extern_convert_any();
        struct_new(ty: TypeIndex);
        struct_new_default(ty: TypeIndex);
        array_new(ty: TypeIndex);
        array_new_default(ty: TypeIndex);
        array_new_fixed(ty: TypeIndex, length: u32);
    }
}

impl VisitVector for Constant<'_, '_> {
    forward! {
        v128_const(bits: u128);
    }
}
