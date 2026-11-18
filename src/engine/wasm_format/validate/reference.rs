use bun_engine_asm::Sign;

use super::{Checked, FrameKind, Validator, is};
use crate::error::Error;
use crate::index::{DataIndex, ElemIndex, FuncIndex, TypeIndex};
use crate::limits::MAX_ARRAY_NEW_FIXED_OPERANDS;
use crate::types::display::{kind_name, storage_name};
use crate::types::{AbstractHeapType, FieldType, HeapType, RefType, StorageType, ValType};
use crate::visitor::VisitReference;

const I32: ValType = ValType::I32;

impl Validator<'_> {
    #[inline]
    fn push_new(&mut self, ty: TypeIndex) -> Checked {
        self.push(self.types().heap_type(ty).non_null())
    }

    #[inline]
    fn nullable(&self, ty: TypeIndex) -> ValType {
        self.types().heap_type(ty).nullable().into()
    }

    fn pop_for_cast(&mut self, name: &'static str, target: RefType) -> Checked {
        let value = self.pop_ref(name, "")?;
        let top = target.heap_type().abstract_type().top();
        if self.fits(value, HeapType::of(top).nullable()) {
            return Ok(());
        }
        let (name, expected) = match top {
            AbstractHeapType::Func => (name, "a funcref"),
            AbstractHeapType::Extern => (name, "an externref"),
            AbstractHeapType::Exn => (name, "an exnref"),
            _ if target.heap_type().index().is_some() => (name, "a subtype of anyref"),
            _ => ("ref.cast", "a subtype of anyref"),
        };
        fail!(validation, "{name} to type {value} expected {expected}");
    }

    /// `expected` is what the message calls `from`.
    fn convert(
        &mut self,
        name: &'static str,
        from: RefType,
        expected: &'static str,
        to: HeapType,
    ) -> Checked {
        let value = self.pop(name)?;
        ensure!(
            self.fits(value, from),
            validation,
            "{name} reference to type {value} expected {expected}"
        );
        self.push(RefType::new(
            to,
            value.as_ref().is_some_and(RefType::is_nullable),
        ))
    }

    #[inline]
    fn pop_struct(&mut self, name: &'static str, ty: TypeIndex) -> Checked {
        let (value, expected) = (self.pop("struct reference")?, self.nullable(ty));
        ensure!(
            self.fits(value, expected),
            validation,
            "{name} structref to type {value} expected {expected}"
        );
        Ok(())
    }

    fn mutable_element(&self, name: &'static str, ty: TypeIndex) -> Result<StorageType, Error> {
        let FieldType { storage, mutable } = self.types().array_type(ty).element;
        ensure!(
            mutable,
            validation,
            "{name} index {ty} does not reference a mutable array definition"
        );
        Ok(storage)
    }

    fn ensure_elem_fits(&self, name: &'static str, elem: ElemIndex, to: StorageType) -> Checked {
        let (from, to) = (self.header.elem(elem).ty, to.unpacked());
        ensure!(
            self.fits(from, to),
            validation,
            "type mismatch in {name}: segment elements have type {from} but {name} operation expects elements of \
             type {to}"
        );
        Ok(())
    }

    fn pop_segment_range(&mut self, name: &'static str) -> Checked {
        for role in ["size", "offset"] {
            let value = self.pop(name)?;
            ensure!(
                is(value, I32),
                validation,
                "{name}: {role} has type {} expected I32",
                kind_name(value)
            );
        }
        Ok(())
    }

    fn pop_init_operands(&mut self, name: &'static str, ty: TypeIndex) -> Checked {
        let dst = self.nullable(ty);
        let operands = [
            ("dst", dst),
            ("dstOffset", I32),
            ("srcOffset", I32),
            ("size", I32),
        ];
        self.pop_operands(name, operands)
    }
}

/// `name` has the suffix for the sign.
fn ensure_sign_fits(
    name: &'static str,
    of: &'static str,
    sign: Option<Sign>,
    storage: StorageType,
) -> Checked {
    let found = storage_name(storage);
    match (sign, storage.packed_size()) {
        (Some(_), None) => fail!(
            parse,
            "{name} applied to wrong type of {of} -- expected: i8 or i16, found {found}"
        ),
        (None, Some(_)) => fail!(
            parse,
            "{name} applied to packed array of {found} -- use {name}_s or {name}_u"
        ),
        _ => Ok(()),
    }
}

fn by_sign(sign: Option<Sign>, names: [&'static str; 3]) -> &'static str {
    match sign {
        None => names[0],
        Some(Sign::Signed) => names[1],
        Some(Sign::Unsigned) => names[2],
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitReference for Validator<'_> {
    #[inline]
    fn ref_null(&mut self, ty: HeapType) -> Checked {
        self.push(ty.nullable())
    }

    #[inline(never)]
    fn ref_is_null(&mut self) -> Checked {
        self.pop_ref("ref.is_null", "")?;
        self.push(I32)
    }

    #[inline(never)]
    fn ref_func(&mut self, func: FuncIndex) -> Checked {
        ensure!(
            self.header.is_declared(func) || self.frames[0].kind == FrameKind::Constant,
            validation,
            "ref.func index {func} isn't declared"
        );
        self.push_new(self.header.func_type_index(func))
    }

    #[inline(never)]
    fn ref_eq(&mut self) -> Checked {
        for (i, value) in self.pop_array::<2>("ref.eq")?.into_iter().rev().enumerate() {
            ensure!(
                self.fits(value, RefType::EQREF),
                validation,
                "ref.eq ref{i} to type {} expected Eqref",
                kind_name(value)
            );
        }
        self.push(I32)
    }

    #[inline(never)]
    fn ref_as_non_null(&mut self) -> Checked {
        let reference = self.pop_ref("ref.as_non_null", " ref")?;
        self.push(reference.heap_type().non_null())
    }

    fn ref_test(&mut self, ty: RefType) -> Checked {
        self.pop_for_cast("ref.test", ty)?;
        self.push(I32)
    }

    fn ref_cast(&mut self, ty: RefType) -> Checked {
        self.pop_for_cast("ref.cast", ty)?;
        self.push(ty)
    }

    fn ref_i31(&mut self) -> Checked {
        self.pop_operands("ref.i31", [("value", I32)])?;
        self.push(HeapType::I31.non_null())
    }

    fn i31_get(&mut self, sign: Sign) -> Checked {
        let name = match sign {
            Sign::Signed => "i31.get_s",
            Sign::Unsigned => "i31.get_u",
        };
        let value = self.pop(name)?;
        ensure!(
            self.fits(value, RefType::I31REF),
            validation,
            "{name} ref to type {value} expected I31ref"
        );
        self.push(I32)
    }

    fn any_convert_extern(&mut self) -> Checked {
        self.convert(
            "any.convert_extern",
            RefType::EXTERNREF,
            "(ref null extern)",
            HeapType::ANY,
        )
    }

    fn extern_convert_any(&mut self) -> Checked {
        self.convert(
            "extern.convert_any",
            RefType::ANYREF,
            "Anyref",
            HeapType::EXTERN,
        )
    }

    fn struct_new(&mut self, ty: TypeIndex) -> Checked {
        let fields = self.types().struct_type(ty).fields;
        let (count, available) = (fields.len(), self.available());
        ensure!(
            self.has(count),
            parse,
            "struct.new {ty} requires {count} values, but the expression stack currently holds {available} values"
        );
        for (&actual, field) in self.top_slice(count).iter().rev().zip(fields.iter().rev()) {
            let expected = field.ty.storage.unpacked();
            ensure!(
                self.fits(actual, expected),
                validation,
                "argument type mismatch in struct.new, got {actual}, expected {expected}"
            );
        }
        self.discard(count);
        self.push_new(ty)
    }

    fn struct_new_default(&mut self, ty: TypeIndex) -> Checked {
        if self.types().fields_are_defaultable(ty) {
            return self.push_new(ty);
        }
        let fields = self.types().struct_type(ty).fields.iter();
        let i = fields
            .take_while(|field| field.ty.storage.unpacked().is_defaultable())
            .count();
        fail!(
            parse,
            "struct.new_default {ty} requires all fields to be defaultable, but field {i} has type Ref"
        );
    }

    fn struct_get(&mut self, ty: TypeIndex, field: u32, sign: Option<Sign>) -> Checked {
        let name = by_sign(sign, ["struct.get", "struct.get_s", "struct.get_u"]);
        let storage = self.types().struct_type(ty).fields[field as usize]
            .ty
            .storage;
        self.pop_struct(name, ty)?;
        ensure_sign_fits(name, "struct", sign, storage)?;
        self.push_loaded(storage.unpacked())
    }

    fn struct_set(&mut self, ty: TypeIndex, field: u32) -> Checked {
        let FieldType { storage, mutable } = self.types().struct_type(ty).fields[field as usize].ty;
        let value = self.pop_early("struct.set value")?;
        self.pop_struct("struct.set", ty)?;
        ensure!(
            mutable,
            parse,
            "the field {field} can't be set because it is immutable"
        );
        ensure!(
            self.fits(value, storage.unpacked()),
            parse,
            "type mismatch in struct.set"
        );
        Ok(())
    }

    fn array_new(&mut self, ty: TypeIndex) -> Checked {
        let element = self.types().array_type(ty).element.storage.unpacked();
        self.pop_operands("array.new", [("value", element), ("index", I32)])?;
        self.push_new(ty)
    }

    fn array_new_default(&mut self, ty: TypeIndex) -> Checked {
        ensure!(
            self.types()
                .array_type(ty)
                .element
                .storage
                .unpacked()
                .is_defaultable(),
            validation,
            "array.new_default index {ty} does not reference an array definition with a defaultable type"
        );
        self.pop_operands("array.new_default", [("index", I32)])?;
        self.push_new(ty)
    }

    fn array_new_fixed(&mut self, ty: TypeIndex, length: u32) -> Checked {
        ensure!(
            length <= MAX_ARRAY_NEW_FIXED_OPERANDS,
            validation,
            "array_new_fixed can take at most {MAX_ARRAY_NEW_FIXED_OPERANDS} operands. Got {length}"
        );
        let available = self.available();
        ensure!(
            self.has(length as usize),
            validation,
            "array_new_fixed: found {available} operands on stack; expected {length} operands"
        );
        let element = self.types().array_type(ty).element.storage.unpacked();
        for &actual in self.top_slice(length as usize).iter().rev() {
            ensure!(
                self.fits(actual, element),
                validation,
                "argument type mismatch in array.new_fixed, got {actual}, expected a subtype of {element}"
            );
        }
        self.discard(length as usize);
        self.push_new(ty)
    }

    fn array_new_data(&mut self, ty: TypeIndex, _: DataIndex) -> Checked {
        self.pop_segment_range("array.new_data")?;
        self.push_new(ty)
    }

    fn array_new_elem(&mut self, ty: TypeIndex, elem: ElemIndex) -> Checked {
        let element = self.types().array_type(ty).element.storage;
        ensure!(
            element.packed_size().is_none(),
            validation,
            "type mismatch in array.new_elem: expected `funcref` or `externref`"
        );
        self.ensure_elem_fits("array.new_elem", elem, element)?;
        self.pop_segment_range("array.new_elem")?;
        self.push_new(ty)
    }

    fn array_get(&mut self, ty: TypeIndex, sign: Option<Sign>) -> Checked {
        let name = by_sign(sign, ["array.get", "array.get_s", "array.get_u"]);
        let element = self.types().array_type(ty).element.storage;
        ensure_sign_fits(name, "array", sign, element)?;
        let ([array, index], expected) = (self.pop_array("array.get")?, self.nullable(ty));
        ensure!(
            self.fits(array, expected),
            validation,
            "{name} arrayref to type {array} expected {expected}"
        );
        ensure!(
            is(index, I32),
            validation,
            "array.get index to type {index} expected I32"
        );
        self.push_loaded(element.unpacked())
    }

    fn array_set(&mut self, ty: TypeIndex) -> Checked {
        let element = self.mutable_element("array.set", ty)?.unpacked();
        let operands = [
            ("arrayref", self.nullable(ty)),
            ("index", I32),
            ("value", element),
        ];
        self.pop_operands("array.set", operands)
    }

    fn array_len(&mut self) -> Checked {
        let value = self.pop("array.len")?;
        ensure!(
            self.fits(value, RefType::ARRAYREF),
            validation,
            "array.len value to type {value} expected arrayref"
        );
        self.push(I32)
    }

    fn array_fill(&mut self, ty: TypeIndex) -> Checked {
        let element = self.mutable_element("array.fill", ty)?.unpacked();
        let array = self.nullable(ty);
        let operands = [
            ("arrayref", array),
            ("offset", I32),
            ("value", element),
            ("size", I32),
        ];
        self.pop_operands("array.fill", operands)
    }

    fn array_copy(&mut self, dst: TypeIndex, src: TypeIndex) -> Checked {
        let to = self.mutable_element("array.copy", dst)?;
        let from = self.types().array_type(src).element.storage;
        ensure!(
            self.types().is_storage_subtype(from, to),
            validation,
            "array.copy src index {src} does not reference a subtype of dst index {dst}"
        );
        let operands = [
            ("dst", self.nullable(dst)),
            ("dstOffset", I32),
            ("src", self.nullable(src)),
            ("srcOffset", I32),
            ("size", I32),
        ];
        self.pop_operands("array.copy", operands)
    }

    fn array_init_data(&mut self, ty: TypeIndex, _: DataIndex) -> Checked {
        ensure!(
            !self.mutable_element("array.init_data", ty)?.is_ref(),
            validation,
            "array.init_data index {ty} must refer to an array definition with numeric or vector type"
        );
        self.pop_init_operands("array.init_data", ty)
    }

    fn array_init_elem(&mut self, ty: TypeIndex, elem: ElemIndex) -> Checked {
        let element = self.mutable_element("array.init_elem", ty)?;
        self.ensure_elem_fits("array.init_elem", elem, element)?;
        self.pop_init_operands("array.init_elem", ty)
    }
}
