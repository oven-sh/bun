//! Instructions with the prefix 0xFB.

use bun_engine_asm::Sign;

use super::{Decoder, Mode, Purpose};
use crate::error::Error;
use crate::index::{DataIndex, ElemIndex, TypeIndex};
use crate::types::{RefType, TypeKind};
use crate::visitor::Visitor;

pub(crate) const STRUCT_SET: u32 = 5;

const FROM_IS_NULLABLE: u8 = 1;
const TO_IS_NULLABLE: u8 = 2;

impl<M: Mode> Decoder<'_, '_, M> {
    #[inline(never)]
    pub(super) fn gc<V: Visitor<Error = M::Error>>(&mut self, v: &mut V) -> Result<(), M::Error> {
        const SIGNED: Option<Sign> = Some(Sign::Signed);
        const UNSIGNED: Option<Sign> = Some(Sign::Unsigned);

        let op = read!(self, self.reader.u32(), "can't parse extended GC opcode");
        match op {
            0 => v.struct_new(self.struct_type("struct.new")?),
            1 => v.struct_new_default(self.struct_type("struct.new_default")?),
            2..=4 => {
                let forms = [
                    ("struct.get", None),
                    ("struct.get_s", SIGNED),
                    ("struct.get_u", UNSIGNED),
                ];
                let (name, sign) = forms[op as usize - 2];
                let (ty, field) = self.field(name)?;
                v.struct_get(ty, field, sign)
            }
            STRUCT_SET => {
                let (ty, field) = self.field("struct.set")?;
                v.struct_set(ty, field)
            }
            6 => v.array_new(self.array_type("array.new", "")?),
            7 => v.array_new_default(self.array_type("array.new_default", "")?),
            8 => {
                let ty = self.array_type("array.new_fixed", "")?;
                let context = self.context();
                let length = read!(
                    self,
                    self.reader.u32(),
                    "can't get argument count for array.new_fixed{context}"
                );
                v.array_new_fixed(ty, length)
            }
            9 => {
                let ty = self.array_type("array.new_data", "")?;
                v.array_new_data(ty, self.data_for_new_array(ty)?)
            }
            10 => {
                let ty = self.array_type("array.new_elem", "")?;
                v.array_new_elem(ty, self.elem_for_new_array()?)
            }
            11 => v.array_get(self.array_type("array.get", "")?, None),
            12 => v.array_get(self.array_type("array.get_s", "")?, SIGNED),
            13 => v.array_get(self.array_type("array.get_u", "")?, UNSIGNED),
            14 => v.array_set(self.array_type("array.set", "")?),
            15 => v.array_len(),
            16 => v.array_fill(self.array_type("array.fill", "")?),
            17 => {
                let dst = self.array_type("array.copy", "first ")?;
                v.array_copy(dst, self.array_type("array.copy", "second ")?)
            }
            18 => {
                let ty = self.array_type("array.init_data", "first ")?;
                self.ensure_second_immediate("array.init_data")?;
                v.array_init_data(ty, self.data()?)
            }
            19 => {
                let ty = self.array_type("array.init_elem", "first ")?;
                self.ensure_second_immediate("array.init_elem")?;
                v.array_init_elem(ty, self.elem()?)
            }
            20 | 21 => {
                let ty = read!(self, self.heap_type(), "can't get heap type for ref.test");
                v.ref_test(RefType::new(ty, op == 21))
            }
            22 | 23 => {
                let ty = read!(self, self.heap_type(), "can't get heap type for ref.cast");
                v.ref_cast(RefType::new(ty, op == 23))
            }
            24 => {
                let (label, from, to) = self.cast_immediates("br_on_cast")?;
                v.br_on_cast(label, from, to)
            }
            25 => {
                let (label, from, to) = self.cast_immediates("br_on_cast_fail")?;
                v.br_on_cast_fail(label, from, to)
            }
            26 => v.any_convert_extern(),
            27 => v.extern_convert_any(),
            28 => v.ref_i31(),
            29 => v.i31_get(Sign::Signed),
            30 => v.i31_get(Sign::Unsigned),
            _ => fail!(self, parse, "invalid extended GC op {op}"),
        }
    }

    #[inline]
    fn struct_type(&mut self, name: &'static str) -> Result<TypeIndex, M::Error> {
        let index = read!(self, self.reader.u32(), "can't get type index for {name}");
        let types = &self.cx.header.types;
        ensure!(
            self,
            index < types.len(),
            validation,
            "{name} index {index} is out of bound"
        );
        ensure!(
            self,
            types.kind(TypeIndex(index)) == TypeKind::Struct,
            validation,
            "{name}: invalid type index {index}"
        );
        Ok(self.visible_type_index(TypeIndex(index)))
    }

    #[inline]
    fn field(&mut self, name: &'static str) -> Result<(TypeIndex, u32), M::Error> {
        let ty = self.struct_type(name)?;
        let field = read!(self, self.reader.u32(), "can't get type index for {name}");
        ensure!(
            self,
            (field as usize) < self.cx.header.types.struct_type(ty).fields.len(),
            parse,
            "{name} field immediate {field} is out of bounds"
        );
        Ok((ty, field))
    }

    #[inline]
    fn array_type(
        &mut self,
        name: &'static str,
        ordinal: &'static str,
    ) -> Result<TypeIndex, M::Error> {
        let index = match self.reader.u32() {
            Some(index) => index,
            None if self.is_dead() => fail!(
                self,
                parse,
                "can't get {ordinal}type index immediate for {name} in unreachable context"
            ),
            None => fail!(self, parse, "can't get type index for {name}"),
        };
        let types = &self.cx.header.types;
        ensure!(
            self,
            index < types.len(),
            validation,
            "{name} index {index} is out of bounds"
        );
        ensure!(
            self,
            types.kind(TypeIndex(index)) == TypeKind::Array,
            validation,
            "{name} index {index} does not reference an array definition"
        );
        Ok(self.visible_type_index(TypeIndex(index)))
    }

    fn ensure_second_immediate(&mut self, name: &'static str) -> Result<(), M::Error> {
        if M::PURPOSE == Purpose::Check && self.is_dead() {
            let start = self.reader;
            read!(
                self,
                self.reader.u32(),
                "can't get second type index immediate for {name} in unreachable context"
            );
            self.reader = start;
        }
        Ok(())
    }

    fn data_for_new_array(&mut self, ty: TypeIndex) -> Result<DataIndex, M::Error> {
        let element = self
            .cx
            .header
            .types
            .array_type(ty)
            .element
            .storage
            .unpacked();
        ensure!(
            self,
            !element.is_ref(),
            validation,
            "array.new_data expected numeric, packed, or vector type; found {element}"
        );
        let context = self.context();
        let index = read!(
            self,
            self.reader.u32(),
            "can't get data segment index for array.new_data{context}"
        );
        let count = self.cx.header.data_count.unwrap_or(0);
        ensure!(
            self,
            count != 0,
            validation,
            "array.new_data in module with no data segments"
        );
        ensure!(
            self,
            index < count,
            validation,
            "array.new_data segment index {index} is out of bounds (maximum data segment index is {})",
            count - 1
        );
        Ok(DataIndex(index))
    }

    fn elem_for_new_array(&mut self) -> Result<ElemIndex, M::Error> {
        let context = self.context();
        let index = read!(
            self,
            self.reader.u32(),
            "can't get elements segment index for array.new_elem{context}"
        );
        let count = self.cx.header.elems.len();
        ensure!(
            self,
            count != 0,
            validation,
            "array.new_elem in module with no elements segments"
        );
        ensure!(
            self,
            (index as usize) < count,
            validation,
            "array.new_elem segment index {index} is out of bounds (maximum element segment index is {})",
            count - 1
        );
        Ok(ElemIndex(index))
    }

    fn cast_immediates(&mut self, name: &'static str) -> Result<(u32, RefType, RefType), M::Error> {
        let Some(flags) = self.reader.u8() else {
            fail!(self, validation, "can't get flags byte for {name}");
        };
        ensure!(
            self,
            flags <= FROM_IS_NULLABLE | TO_IS_NULLABLE,
            validation,
            "reserved bits set in flags byte for {name}"
        );
        let label = self.label()?;
        let from = read!(
            self,
            self.heap_type(),
            "can't get first heap type for {name}"
        );
        let to = read!(
            self,
            self.heap_type(),
            "can't get second heap type for {name}"
        );
        Ok((
            label,
            RefType::new(from, flags & FROM_IS_NULLABLE != 0),
            RefType::new(to, flags & TO_IS_NULLABLE != 0),
        ))
    }
}
