//! <https://drafts.csswg.org/cssom/#utility-apis>

use bun_jsc::JSString;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope, Result};

use crate::api::core::{DomError, DomString, StringBuilder, dom_error, seams};
use crate::api::highlight::HighlightRegistry;
use crate::api::typed::CSSNumericValue;
use crate::calc::Unit;
use crate::custom::{Registered, remember};
use crate::generated_bindgen::cssom::{CSSNamespace, PropertyDefinition};

impl CSSNamespace {
    /// <https://drafts.csswg.org/cssom/#serialize-an-identifier>, which keeps lone surrogates.
    pub(crate) fn escape<'a>(
        heap: &JsHeap<'a>,
        ident: JsLocal<'a, JSString>,
    ) -> Result<'a, JsLocal<'a, JSString>> {
        let ident = DomString::from_js_string(heap, ident)?;
        let (mut out, starts_with_dash) = (
            StringBuilder::with_capacity(ident.len() as usize),
            ident.units().next() == Some(b'-'.into()),
        );
        for (index, unit) in ident.units().enumerate() {
            match u8::try_from(unit) {
                Ok(0) => out.push_unit(0xfffd),
                Ok(1..=0x1f | 0x7f) => out.push_str(&format!("\\{unit:x} ")),
                Ok(b'0'..=b'9') if index == 0 || index == 1 && starts_with_dash => {
                    out.push_str(&format!("\\{unit:x} "))
                }
                Ok(b'-') if ident.len() == 1 => out.push_str("\\-"),
                Ok(byte)
                    if byte.is_ascii()
                        && !byte.is_ascii_alphanumeric()
                        && !matches!(byte, b'-' | b'_') =>
                {
                    out.push_latin1(&[b'\\', byte])
                }
                _ => out.push_unit(unit),
            }
        }
        Ok(out.finish().to_js(heap))
    }

    pub(crate) fn supports_declaration(property: &[u8], value: &[u8]) -> bool {
        crate::sheet::supports_declaration(property, value)
    }

    pub(crate) fn supports_condition(condition: &[u8]) -> bool {
        let holds = |it: &[u8]| crate::condition::supports(it, Default::default()) == Some(true);
        holds(condition) || holds(&[b"(", condition, b")"].concat())
    }

    /// <https://drafts.css-houdini.org/css-properties-values-api/#register-a-custom-property>
    pub(crate) fn register_property<'a>(
        cx: &mut JsScope<'a>,
        definition: &PropertyDefinition<'_>,
    ) -> Result<'a, ()> {
        let doc = seams::current_document(cx)?;
        let PropertyDefinition {
            inherits,
            initial_value,
            name,
            syntax,
        } = *definition;
        (name.starts_with(b"--") && name.len() > 2).ok_or_else(|| {
            dom_error(
                &cx.heap,
                DomError::SyntaxError,
                "Custom property names must start with '--'.",
            )
        })?;
        let name = remember(name);
        if doc.engine(|engine, _| engine.is_registered_by_script(name)) {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidModificationError,
                "The name has already been registered.",
            ));
        }
        let is_valid = doc.engine(|engine, _| {
            Registered::parse(syntax, inherits, initial_value, &engine.base_url)
                .is_some_and(|it| engine.register_property(name, it))
        });
        is_valid.ok_or_else(|| {
            dom_error(
                &cx.heap,
                DomError::SyntaxError,
                "The syntax or the initial value is not valid.",
            )
        })?;
        doc.invalidate(cx);
        Ok(())
    }

    pub(crate) fn get_highlights<'a>(cx: &mut JsScope<'a>) -> Result<'a, &'a HighlightRegistry> {
        let doc = seams::current_document(cx)?;
        Ok(HighlightRegistry::of(&cx.heap, doc))
    }
}

macro_rules! numeric_factories {
    ($($name:ident $Unit:ident)+) => {
        impl CSSNamespace {
            $(pub(crate) fn $name<'a>(heap: &JsHeap<'a>, value: f64) -> &'a CSSNumericValue {
                CSSNumericValue::of_unit(heap, value, Unit::$Unit)
            })+
        }
    };
}

numeric_factories! {
    unit_number Number unit_percent Percent unit_cap Cap unit_ch Ch unit_em Em unit_ex Ex unit_ic Ic unit_lh Lh unit_rcap Rcap unit_rch Rch
    unit_rem Rem unit_rex Rex unit_ric Ric unit_rlh Rlh unit_vw Vw unit_vh Vh unit_vi Vi unit_vb Vb unit_vmin Vmin unit_vmax Vmax
    unit_svw Svw unit_svh Svh unit_svi Svi unit_svb Svb unit_svmin Svmin unit_svmax Svmax unit_lvw Lvw unit_lvh Lvh unit_lvi Lvi
    unit_lvb Lvb unit_lvmin Lvmin unit_lvmax Lvmax unit_dvw Dvw unit_dvh Dvh unit_dvi Dvi unit_dvb Dvb unit_dvmin Dvmin unit_dvmax Dvmax
    unit_cqw Cqw unit_cqh Cqh unit_cqi Cqi unit_cqb Cqb unit_cqmin Cqmin unit_cqmax Cqmax unit_cm Cm unit_mm Mm unit_q Q unit_in In
    unit_pt Pt unit_pc Pc unit_px Px unit_deg Deg unit_grad Grad unit_rad Rad unit_turn Turn unit_s S unit_ms Ms unit_hz Hz unit_khz Khz
    unit_dpi Dpi unit_dpcm Dpcm unit_dppx Dppx unit_x X unit_fr Fr
}
