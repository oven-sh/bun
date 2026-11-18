use std::rc::Rc;

use bun_engine_text::{StringRef, Text};

use super::{Decoder, Writer, flag, optional};
use crate::bytes::{Reader, fold_sign, unfold_sign};
use crate::cache::format::{canonical, constant};
use crate::constant::{
    ArrayLiteral, BigIntLiteral, Constant, LinkTimeConstant, RegExpLiteral, TemplateSite,
};

impl Writer<'_> {
    fn double(&mut self, value: f64) {
        self.bytes().put(&canonical(value).to_le_bytes());
    }

    fn start_in_source(&self, text: Text<'_>) -> Option<usize> {
        let (Text::Latin1(part), Text::Latin1(whole)) = (text, self.source.text()) else {
            return None;
        };
        let start = part.as_ptr().addr().checked_sub(whole.as_ptr().addr())?;
        (start + part.len() <= whole.len()).then_some(start)
    }

    pub(super) fn constant(&mut self, value: &Constant) {
        let (tag, rest) = match value {
            Constant::String(atom) => {
                let reference = self.reference(atom.text(), atom.name().hash());
                (constant::STRING, u64::from(reference))
            }
            Constant::Int32(value) => (constant::INT32, u64::from(fold_sign(*value))),
            Constant::LinkTime(value) => (constant::LINK_TIME, u64::from(value.0)),
            _ => return self.other_constant(value),
        };
        self.bytes().long(rest << constant::TAG_BITS | tag);
    }

    fn kind_of_constant(&mut self, kind: u64) {
        (self.bytes()).long(kind << constant::TAG_BITS | constant::OTHER);
    }

    fn other_constant(&mut self, value: &Constant) {
        match value {
            Constant::String(_) | Constant::Int32(_) | Constant::LinkTime(_) => unreachable!(),
            Constant::Empty => self.kind_of_constant(constant::EMPTY),
            Constant::Undefined => self.kind_of_constant(constant::UNDEFINED),
            Constant::Null => self.kind_of_constant(constant::NULL),
            Constant::Boolean(false) => self.kind_of_constant(constant::FALSE),
            Constant::Boolean(true) => self.kind_of_constant(constant::TRUE),
            Constant::Double(value) => {
                self.kind_of_constant(constant::DOUBLE);
                self.double(*value);
            }
            Constant::LongString(string) => match self.start_in_source(string.text()) {
                Some(start) => {
                    self.is_too_long(string.len());
                    self.kind_of_constant(constant::PART_OF_SOURCE);
                    self.bytes().count(start);
                    self.bytes().count(string.len());
                }
                None => {
                    self.kind_of_constant(constant::LONG_STRING);
                    self.text(string.text());
                }
            },
            Constant::BigInt(literal) => {
                self.kind_of_constant(constant::BIGINT);
                (self.bytes()).put(&[literal.radix, u8::from(literal.is_negative)]);
                self.text(literal.digits.text());
            }
            Constant::RegExp(literal) => {
                self.kind_of_constant(constant::REGEXP);
                self.atom(&literal.pattern);
                self.atom(&literal.flags);
            }
            Constant::Template(site) => {
                self.kind_of_constant(constant::TEMPLATE);
                self.bytes().number(site.end);
                self.list(&site.raw, Self::atom);
                self.list(&site.cooked, |w, it| w.optional(it.as_ref(), Self::atom));
            }
            Constant::Array(literal) => match &**literal {
                ArrayLiteral::Int32(values) => {
                    self.kind_of_constant(constant::INT32_ARRAY);
                    self.list(values, |w, &value| w.bytes().number(fold_sign(value)));
                }
                ArrayLiteral::Double(values) => {
                    self.kind_of_constant(constant::DOUBLE_ARRAY);
                    self.list(values, |w, &value| w.double(value));
                }
                ArrayLiteral::Strings(values) => {
                    self.kind_of_constant(constant::STRING_ARRAY);
                    self.list(values, Self::atom);
                }
                ArrayLiteral::Values(values) => {
                    self.kind_of_constant(constant::VALUE_ARRAY);
                    self.list(values, Self::constant);
                }
            },
        }
    }
}

fn double(reader: &mut Reader<'_>) -> Option<f64> {
    Some(canonical(f64::from_le_bytes(reader.array()?)))
}

impl Decoder<'_> {
    #[inline]
    pub(super) fn constant(&self, reader: &mut Reader<'_>, is_element: bool) -> Option<Constant> {
        let head = reader.long()?;
        let rest = u32::try_from(head >> constant::TAG_BITS).ok()?;
        Some(match head % (1 << constant::TAG_BITS) {
            constant::STRING => Constant::String(self.atom_for(rest)?),
            constant::INT32 => Constant::Int32(unfold_sign(rest)),
            constant::LINK_TIME => Constant::LinkTime(LinkTimeConstant(rest.try_into().ok()?)),
            _ => self.other_constant(reader, u64::from(rest), is_element)?,
        })
    }

    fn other_constant(
        &self,
        reader: &mut Reader<'_>,
        kind: u64,
        is_element: bool,
    ) -> Option<Constant> {
        let array = |literal| Constant::Array(Rc::new(literal));
        Some(match kind {
            constant::EMPTY => Constant::Empty,
            constant::UNDEFINED => Constant::Undefined,
            constant::NULL => Constant::Null,
            constant::FALSE => Constant::Boolean(false),
            constant::TRUE => Constant::Boolean(true),
            constant::DOUBLE => Constant::Double(double(reader)?),
            constant::LONG_STRING => Constant::LongString(self.string(reader)?),
            constant::PART_OF_SOURCE => {
                let start = reader.number()?;
                let end = start.checked_add(reader.number()?)?;
                self.is_in_source(start, end).then_some(())?;
                let range = start as usize..end as usize;
                Constant::LongString(StringRef::substring(&self.unit.source, range))
            }
            constant::BIGINT => Constant::BigInt(Rc::new(BigIntLiteral {
                radix: reader.byte()?,
                is_negative: flag(reader)?,
                digits: self.string(reader)?,
            })),
            constant::REGEXP => Constant::RegExp(Rc::new(RegExpLiteral {
                pattern: self.atom(reader)?,
                flags: self.atom(reader)?,
            })),
            constant::TEMPLATE => Constant::Template(Rc::new(TemplateSite {
                end: reader.number()?,
                raw: self.atoms(reader)?,
                cooked: reader.list(|reader| optional(reader, |reader| self.atom(reader)))?,
            })),
            constant::INT32_ARRAY => array(ArrayLiteral::Int32(
                reader.list(|reader| reader.number().map(unfold_sign))?,
            )),
            constant::DOUBLE_ARRAY => array(ArrayLiteral::Double(reader.list(double)?)),
            constant::STRING_ARRAY => array(ArrayLiteral::Strings(self.atoms(reader)?)),
            constant::VALUE_ARRAY if !is_element => array(ArrayLiteral::Values(
                reader.list(|reader| self.constant(reader, true))?,
            )),
            _ => return None,
        })
    }
}
