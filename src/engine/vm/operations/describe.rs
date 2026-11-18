//! How a value is represented, in words.

use core::fmt::{Result, Write};

use bun_engine_text::{StringBuilder, StringRef};

use crate::{
    ElementKind, Gc, IndexingMode, JsBigInt, JsCell, JsObject, JsString, Message, Shape, Storage,
    Value,
};

impl IndexingMode {
    pub fn describe(self, out: &mut impl Write) -> Result {
        let prefix = if !self.is_array() {
            "Non"
        } else if self.is_copy_on_write() && !self.is_slow_put() {
            "CopyOnWrite"
        } else {
            ""
        };
        let elements = match self.kind() {
            ElementKind::None if self.is_array() => "Class",
            ElementKind::None => "",
            _ if self.is_slow_put() => "WithSlowPutArrayStorage",
            ElementKind::Undecided => "WithUndecided",
            ElementKind::Int32 => "WithInt32",
            ElementKind::Double => "WithDouble",
            ElementKind::Contiguous => "WithContiguous",
            ElementKind::Sparse => "WithArrayStorage",
        };
        write!(out, "{prefix}Array{elements}")
    }
}

fn describe_shape(shape: &Shape, out: &mut StringBuilder) -> Result {
    let (address, id, class) = (shape.address(), shape.id().bits(), shape.class().name());
    write!(out, "{address:#x}:[{id:#x}/{id}, {class}, ")?;
    write!(
        out,
        "({}/{}, {}/{}){{",
        shape.inline_size(),
        shape.inline_capacity(),
        shape.out_of_line_size(),
        shape.out_of_line_capacity()
    )?;
    for (index, (name, offset, _)) in shape.properties().iter().enumerate() {
        out.push_ascii(if index == 0 { "" } else { ", " });
        out.push_text(name.text());
        write!(out, ":{}", offset.get())?;
    }
    out.push_ascii("}, ");
    shape.instance_indexing_mode().describe(out)?;
    write!(out, ", {:?}", shape.transition_kind())?;
    if let Some(prototype) = shape.prototype_object() {
        write!(out, ", Proto:{:#x}", prototype.address())?;
    }
    if shape.is_uncacheable_dictionary() {
        out.push_ascii(", UncacheableDictionary");
    } else if shape.is_dictionary() {
        out.push_ascii(", Dictionary");
    }
    if shape.transition_watchpoints().is_still_valid() {
        out.push_ascii(", Leaf");
    }
    out.write_char(']')
}

fn describe_string(string: &JsString, out: &mut StringBuilder) -> Result {
    const MAX_SHOWN: usize = 5_000_000;
    const SHOWN_OF_MORE: usize = 1000;
    let kind = match (string.is_rope(), string.is_atom()) {
        (true, _) => " (rope) (unresolved)",
        (_, true) => " (atomic)",
        _ => "",
    };
    let (is_latin1, length) = (u8::from(string.is_latin1()), string.len());
    write!(out, "String{kind},8Bit:({is_latin1}),length:({length}): ")?;
    match string.try_resolved() {
        Some(resolved) if resolved.len() > MAX_SHOWN => {
            out.push_text(resolved.text().slice(0..SHOWN_OF_MORE));
            let rest = resolved.len() - SHOWN_OF_MORE;
            write!(out, "...[{rest} characters not shown]")?;
        }
        Some(resolved) => out.push_text(resolved.text()),
        None => out.push_ascii("(null StringImpl*)"),
    }
    Ok(())
}

fn describe_cell(cell: &JsCell, out: &mut StringBuilder) -> Result {
    let (address, shape, value) = (cell.address(), cell.shape(), Value::from(cell));
    if let Some(string) = value.as_string() {
        describe_string(&string, out)?;
    } else if value.is_symbol() {
        write!(out, "Symbol: {address:#x}")?;
    } else if let Some(bigint) = value.downcast::<JsBigInt>() {
        let (length, sign) = (bigint.value().digits().len(), bigint.is_negative());
        write!(out, "BigInt[heap-allocated]: addr={address:#x}, ")?;
        write!(out, "length={length}, sign={sign}")?;
    } else {
        let storage_of = |object: Gc<JsObject>| match object.cell_type().has_storage() {
            true => object.storage(),
            false => Storage::NONE,
        };
        match value.as_object().map(storage_of) {
            Some(storage) if storage.is_none() => {
                write!(out, "Object: {address:#x} with butterfly (nil) (Structure ")?;
            }
            Some(storage) => write!(
                out,
                "Object: {address:#x} with butterfly {:#x}(base={:#x}) (Structure ",
                storage.address(),
                storage.base(shape.out_of_line_capacity())
            )?,
            None => write!(out, "Cell: {address:#x} (")?,
        }
        describe_shape(&shape, out)?;
        out.write_char(')')?;
    }
    write!(out, ", StructureID: {}", shape.id().bits())
}

impl Value {
    pub fn describe(self) -> StringRef {
        let mut out = StringBuilder::new();
        let _ = if let Some(integer) = self.as_int32() {
            write!(out, "Int32: {integer}")
        } else if let Some(number) = self.as_double() {
            write!(out, "Double: {}, {number:.6}", number.to_bits() as i64)
        } else if let Some(cell) = self.as_cell() {
            describe_cell(&cell, &mut out)
        } else {
            out.write_str(match self {
                Value::TRUE => "True",
                Value::FALSE => "False",
                Value::NULL => "Null",
                _ => "Undefined",
            })
        };
        out.into_string()
    }
}
