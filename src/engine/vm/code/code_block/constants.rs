//! The values of the constants of the code.

use bun_engine_bytecode::{ArrayLiteral, Constant, TemplateSite};
use bun_engine_text::names;

use crate::{
    Attributes, CodeBlock, Cx, Gc, ImmutableArray, IntegrityLevel, JsArray, JsBigInt, JsResult,
    JsString, RealmSlot, RegExp, Value, ValueVec,
};

impl CodeBlock {
    pub(super) fn link_constant(
        &self,
        cx: &mut Cx,
        constant: &Constant,
    ) -> JsResult<Option<Value>> {
        Ok(Some(match constant {
            Constant::Empty => return Ok(None),
            Constant::Undefined => Value::UNDEFINED,
            Constant::Null => Value::NULL,
            &Constant::Boolean(value) => value.into(),
            &Constant::Int32(value) => Value::int32(value),
            &Constant::Double(value) => Value::double(value),
            Constant::String(atom) => JsString::from_name(cx, atom.name()).into(),
            Constant::LongString(string) => JsString::new_uncharged(cx, string.clone()).into(),
            Constant::BigInt(literal) => {
                use bun_engine_bigint::LiteralRadix;
                let radix = match literal.radix {
                    2 => LiteralRadix::Binary,
                    8 => LiteralRadix::Octal,
                    16 => LiteralRadix::Hexadecimal,
                    _ => LiteralRadix::Decimal,
                };
                let digits = literal.digits.text();
                JsBigInt::from_literal(cx, digits, radix, literal.is_negative)?.into()
            }
            Constant::RegExp(literal) => {
                RegExp::for_literal(cx, literal.pattern.string(), literal.flags.text()).into()
            }
            Constant::Template(site) => self.template_object(cx, site)?.into(),
            Constant::Array(literal) => self.link_array(cx, literal)?.into(),
            &Constant::LinkTime(id) => cx.global().slot(cx, RealmSlot::for_constant(id)).into(),
        }))
    }

    fn link_array(&self, cx: &mut Cx, literal: &ArrayLiteral) -> JsResult<Gc<ImmutableArray>> {
        let mut values = ValueVec::new();
        match literal {
            ArrayLiteral::Int32(values) => {
                return cx.or_out_of_memory(ImmutableArray::try_from_int32s(cx, values));
            }
            ArrayLiteral::Double(values) => {
                return cx.or_out_of_memory(ImmutableArray::try_from_doubles(cx, values));
            }
            ArrayLiteral::Strings(atoms) => {
                for atom in atoms {
                    values.push(JsString::from_name(cx, atom.name()).into());
                }
            }
            ArrayLiteral::Values(constants) => {
                for constant in constants {
                    values.push(self.link_constant(cx, constant)?.unwrap_or_default());
                }
            }
        }
        cx.or_out_of_memory(ImmutableArray::try_from_values(cx, &values))
    }

    /// GetTemplateObject
    fn template_object(&self, cx: &mut Cx, site: &TemplateSite) -> JsResult<Gc<JsArray>> {
        let top_level = self.executable().top_level();
        if let Some(object) = top_level.template_objects().get(&site.end) {
            return Ok(object);
        }
        let (mut cooked, mut raw) = (ValueVec::new(), ValueVec::new());
        for (cooked_text, raw_text) in site.cooked.iter().zip(&site.raw) {
            let cooked_text = cooked_text.as_ref();
            cooked.push(cooked_text.map_or_default(|it| JsString::from_name(cx, it.name()).into()));
            raw.push(JsString::from_name(cx, raw_text.name()).into());
        }
        let (object, raw) = (cx.new_array_from(&cooked)?, cx.new_array_from(&raw)?);
        raw.restrict_ordinary(cx, IntegrityLevel::Frozen);
        object.put_direct(cx, names::raw, raw.into(), Attributes::CONSTANT);
        object.restrict_ordinary(cx, IntegrityLevel::Frozen);
        top_level.template_objects().insert(site.end, object);
        Ok(object)
    }

    pub fn constant(&self, index: u32) -> Option<Value> {
        self.baseline().fields()[..self.code().constants.len()][index as usize].get()
    }

    /// By the same elements in a more general kind. Code that has the address of the old one keeps that alive itself.
    pub fn replace_array_constant(&self, index: u32, elements: Gc<ImmutableArray>) {
        let owner = self.baseline();
        let field = &owner.fields()[..self.code().constants.len()][index as usize];
        assert!(field.get().is_some_and(Value::is::<ImmutableArray>));
        // SAFETY: one of its own.
        unsafe { field.set(&owner, Some(elements.into())) };
    }
}
