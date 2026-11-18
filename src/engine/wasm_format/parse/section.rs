//! What the parsers of all sections use.

use bun_engine_asm::Width;

use crate::alloc::TryPush;
use crate::decode::V128_CONST;
use crate::error::{Error, Quoted};
use crate::index::{FuncIndex, GlobalIndex};
use crate::module::{ConstCode, ConstExpr, Features, ModuleHeader, Span};
use crate::opcode::{
    END, F32_CONST, F64_CONST, GC_PREFIX, GLOBAL_GET, I32_CONST, I64_CONST, REF_FUNC, REF_NULL,
    VECTOR_PREFIX,
};
use crate::reader::Reader;
use crate::types::{RefType, ValType};
use crate::validate::{Scratch, validate_const_expr};

pub(super) type Parsed = Result<(), Error>;

pub(super) struct Section<'a> {
    pub(super) reader: Reader<'a>,
    /// Of the payload, in the module.
    offset: usize,
    scratch: &'a mut Scratch,
    /// By the constant expressions since they were last declared.
    named_funcs: Vec<FuncIndex>,
}

impl<'a> Section<'a> {
    pub(super) fn new(payload: &'a [u8], offset: usize, scratch: &'a mut Scratch) -> Self {
        Self {
            reader: Reader::new(payload, 0),
            offset,
            scratch,
            named_funcs: Vec::new(),
        }
    }

    /// In the module.
    pub(super) fn position(&self) -> usize {
        self.offset + self.reader.position()
    }

    #[cold]
    pub(super) fn out_of_memory(&self) -> Error {
        Error::parse(
            self.position(),
            format_args!("can't allocate enough memory for the section"),
        )
    }

    pub(super) fn push<T>(&self, vec: &mut Vec<T>, item: T) -> Parsed {
        vec.try_push(item).map_err(|_| self.out_of_memory())
    }

    /// For no more items than the rest of the section can hold.
    pub(super) fn reserve<T>(&self, vec: &mut Vec<T>, count: u32, least_size: usize) -> Parsed {
        let count = (count as usize).min(self.reader.remaining() / least_size);
        vec.try_reserve(count).map_err(|_| self.out_of_memory())
    }

    pub(super) fn count(&mut self, section: &str, maximum: u32) -> Result<u32, Error> {
        let count = read!(
            self,
            self.reader.u32(),
            "can't get {section} section's count"
        );
        ensure!(
            self,
            count <= maximum,
            "{section} section's count is too big {count} maximum {maximum}"
        );
        Ok(count)
    }

    pub(super) fn span(&mut self, len: u32) -> Option<Span> {
        let start = self.position() as u32;
        self.reader.slice(len as usize)?;
        Some(Span { start, len })
    }

    pub(super) fn name(&mut self, len: u32) -> Option<(Span, Quoted<'a>)> {
        let mut reader = self.reader;
        let text = core::str::from_utf8(reader.slice(len as usize)?).ok()?;
        Some((self.span(len)?, Quoted(text)))
    }

    pub(super) fn bytes(&self, span: Span) -> &'a [u8] {
        &self.reader.bytes()[span.start as usize - self.offset..][..span.len as usize]
    }

    pub(super) fn mutability(&self, byte: u8, of: &str) -> Result<bool, Error> {
        ensure!(self, byte <= 1, "invalid {of} mutability: 0x{byte:02x}");
        Ok(byte == 1)
    }

    pub(super) fn value_type(&mut self, header: &ModuleHeader) -> Option<ValType> {
        header.value_type(&mut self.reader)
    }

    pub(super) fn ref_type(&mut self, header: &ModuleHeader) -> Result<RefType, Error> {
        let ty = self.value_type(header).and_then(ValType::as_ref);
        Ok(read!(self, ty, "can't parse reftype in elem section"))
    }

    pub(super) fn declare_named_funcs(&mut self, header: &mut ModuleHeader) {
        for func in self.named_funcs.drain(..) {
            header.declare(func);
        }
    }

    pub(super) fn offset_expr(
        &mut self,
        header: &ModuleHeader,
        address: Width,
        of: &str,
    ) -> Result<ConstExpr, Error> {
        let (expr, ty) = self.const_expr(header, ValType::int(address))?;
        let bits = address.bits();
        ensure!(
            self,
            ty == ValType::int(address),
            "{of} init_expr must produce an i{bits}"
        );
        Ok(expr)
    }

    /// The caller checks the type that is returned.
    pub(super) fn const_expr(
        &mut self,
        header: &ModuleHeader,
        expected: ValType,
    ) -> Result<(ConstExpr, ValType), Error> {
        let (start, offset) = (self.reader.position(), self.position());
        let code = ConstExpr::Code(ConstCode(offset as u32));
        let first = self.first_instruction(header, code)?;
        let next = read!(self, self.reader.peek(), "can't get init_expr's end opcode");
        if let Some(only) = first
            && next == END
        {
            self.reader.u8();
            if let (ConstExpr::RefFunc(func), _) = only {
                self.named_funcs
                    .try_push(func)
                    .map_err(|_| self.out_of_memory())?;
            }
            return Ok(only);
        }
        let bytes = &self.reader.bytes()[start..];
        let funcs = &mut self.named_funcs;
        let length = validate_const_expr(header, bytes, offset, expected, self.scratch, funcs)?;
        self.reader.set_position(start + length);
        Ok((code, expected))
    }

    /// `None` if it is left to the validator.
    fn first_instruction(
        &mut self,
        header: &ModuleHeader,
        code: ConstExpr,
    ) -> Result<Option<(ConstExpr, ValType)>, Error> {
        const NO_VALUE: &str = "can't get constant value for init_expr's";
        let op = read!(self, self.reader.u8(), "can't get init_expr's opcode");
        Ok(Some(match op {
            I32_CONST => {
                let value = read!(self, self.reader.i32(), "{NO_VALUE} i32.const");
                (ConstExpr::I32(value), ValType::I32)
            }
            I64_CONST => {
                let value = read!(self, self.reader.i64(), "{NO_VALUE} i64.const");
                (ConstExpr::I64(value), ValType::I64)
            }
            F32_CONST => {
                let bytes = read!(self, self.reader.array(), "{NO_VALUE} f32.const");
                (ConstExpr::F32(u32::from_le_bytes(bytes)), ValType::F32)
            }
            F64_CONST => {
                let bytes = read!(self, self.reader.array(), "{NO_VALUE} f64.const");
                (ConstExpr::F64(u64::from_le_bytes(bytes)), ValType::F64)
            }
            VECTOR_PREFIX => {
                ensure!(
                    self,
                    header.features.contains(Features::SIMD),
                    "SIMD must be enabled"
                );
                let mut reader = self.reader;
                read!(self, self.reader.u8(), "can't get init_expr's simd opcode");
                ensure!(
                    self,
                    reader.u32() == Some(V128_CONST),
                    "unknown init_expr simd opcode {op}"
                );
                self.reader = reader;
                read!(
                    self,
                    self.reader.slice(16),
                    "get constant value for init_expr's v128.const"
                );
                (code, ValType::V128)
            }
            GLOBAL_GET => {
                let index = read!(self, self.reader.u32(), "can't get get_global's index");
                let count = header.globals.len();
                let global = read!(
                    self,
                    header.globals.get(index as usize),
                    "get_global's index {index} exceeds the number of globals {count}"
                );
                ensure!(
                    self,
                    !global.mutable,
                    "get_global import kind index {index} is mutable "
                );
                (ConstExpr::GlobalGet(GlobalIndex(index)), global.ty)
            }
            REF_NULL => {
                let ty = read!(
                    self,
                    header.heap_type(&mut self.reader),
                    "ref.null heaptype must be funcref, externref or type_idx"
                );
                (ConstExpr::RefNull, ty.nullable().into())
            }
            REF_FUNC => {
                let index = read!(self, self.reader.u32(), "can't get ref.func index");
                let count = header.funcs.len();
                let &ty = read!(
                    self,
                    header.funcs.get(index as usize),
                    "ref.func index {index} exceeds the number of functions {count}"
                );
                let ty = header.types.heap_type(ty).non_null();
                (ConstExpr::RefFunc(FuncIndex(index)), ty.into())
            }
            GC_PREFIX => return Ok(None),
            _ => fail!(self, "unknown init_expr opcode {op}"),
        }))
    }
}
