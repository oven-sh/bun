use bun_engine_text::Text;
use bun_engine_vm::StringView;
use bun_engine_vm::caches::get_megamorphic;

use super::prelude::*;
use crate::{KeywordValue, LocaleMatcher, OptionValue, Result};

/// The `options` argument. Each method returns `None` for a property that is undefined.
#[derive(Clone, Copy)]
pub(super) struct OptionBag(Option<Gc<JsObject>>);

impl OptionBag {
    /// CoerceOptionsToObject
    pub(super) fn coerce(cx: &Cx, options: Value) -> JsResult<OptionBag> {
        if options.is_undefined() {
            return Ok(OptionBag(None));
        }
        Ok(OptionBag(Some(options.to_object(cx)?)))
    }

    /// GetOptionsObject
    pub(super) fn require(cx: &Cx, options: Value) -> JsResult<OptionBag> {
        if !options.is_undefined() && !options.is_object() {
            return Err(cx.throw_type_error("options argument is not an object or undefined"));
        }
        Ok(OptionBag(options.as_object()))
    }

    #[inline]
    pub(super) fn get(self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Option<Value>> {
        let Some(options) = self.0 else {
            return Ok(None);
        };
        let value = get_megamorphic(cx, options.into(), name)?;
        Ok((!value.is_undefined()).then_some(value))
    }

    #[inline]
    pub(super) fn string(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<Option<StringView>> {
        let value = self.get(cx, name)?;
        value.map(|value| value.to_string_view(cx)).transpose()
    }

    #[inline]
    pub(super) fn parse<T>(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        parse: impl FnOnce(Text<'_>) -> Result<T>,
    ) -> JsResult<Option<T>> {
        let string = self.string(cx, name)?;
        (string.map(|string| parse(string.text())).transpose()).or_throw(cx)
    }

    #[inline]
    pub(super) fn value<T: OptionValue>(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<Option<T>> {
        self.parse(cx, name, T::parse)
    }

    #[inline]
    pub(super) fn value_or_default<T: OptionValue + Default>(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<T> {
        Ok(self.value(cx, name)?.unwrap_or_default())
    }

    #[inline]
    pub(super) fn boolean(self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Option<bool>> {
        Ok(self.get(cx, name)?.map(|value| value.to_boolean(cx)))
    }

    #[inline]
    pub(super) fn number<T>(
        self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        check: impl FnOnce(f64) -> Result<T>,
    ) -> JsResult<Option<T>> {
        match self.get(cx, name)? {
            Some(value) => check(value.to_number(cx)?).or_throw(cx).map(Some),
            None => Ok(None),
        }
    }

    pub(super) fn check_locale_matcher(self, cx: &mut Cx) -> JsResult<()> {
        self.value::<LocaleMatcher>(cx, names::localeMatcher)?;
        Ok(())
    }

    pub(super) fn numbering_system(self, cx: &mut Cx) -> JsResult<Option<KeywordValue>> {
        self.parse(cx, names::numberingSystem, KeywordValue::numbering_system)
    }
}
