use bun_engine_text::StringRef;

use super::prelude::*;
use super::results::values_to_array;
use crate::locale::{Locale, Options};
use crate::{KeywordValue, LanguageTag};

#[cell(name = "Object")]
pub(super) struct JsLocale {
    base: JsDestructibleObject,
    locale: Locale,
}

impl JsLocale {
    pub(super) fn tag(&self) -> &LanguageTag {
        self.locale.tag()
    }

    fn create(cx: &Cx, shape: Gc<Shape>, locale: Locale) -> Value {
        let base = JsObjectInit::new(cx, shape);
        cx.allocate::<JsLocale>(JsLocaleInit { base, locale })
            .into()
    }
}

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::maximize, maximize, 0),
    StaticProperty::function(names::minimize, minimize, 0),
    StaticProperty::function(names::toString, to_string, 0),
    StaticProperty::function(names::getCalendars, get_calendars, 0),
    StaticProperty::function(names::getCollations, get_collations, 0),
    StaticProperty::function(names::getHourCycles, get_hour_cycles, 0),
    StaticProperty::function(names::getNumberingSystems, get_numbering_systems, 0),
    StaticProperty::function(names::getTimeZones, get_time_zones, 0),
    StaticProperty::function(names::getTextInfo, get_text_info, 0),
    StaticProperty::function(names::getWeekInfo, get_week_info, 0),
    getter(names::baseName, base_name),
    getter(names::calendar, calendar),
    getter(names::caseFirst, case_first),
    getter(names::collation, collation),
    getter(names::firstDayOfWeek, first_day_of_week),
    getter(names::hourCycle, hour_cycle),
    getter(names::numeric, numeric),
    getter(names::numberingSystem, numbering_system),
    getter(names::language, language),
    getter(names::script, script),
    getter(names::region, region),
    getter(names::variants, variants),
    StaticProperty::string(symbols::toStringTag, names::intlLocale),
]);

static_table!(static CONSTRUCTOR_PROPERTIES = []);

define_class!(
    Locale: JsLocale, "Intl.Locale", length 1, CONSTRUCTOR_PROPERTIES,
    init_locale_constructor, init_locale_shape
);

define_throwing_call!("Locale");

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::locale_shape)?;
    let (tag, options) = (frame.argument(0), frame.argument(1));
    if !tag.is_string() && !tag.is_object() {
        let message = "First argument to Intl.Locale must be a string or an object";
        return Err(cx.throw_type_error(message));
    }
    let tag = match tag.downcast::<JsLocale>() {
        Some(locale) => locale.tag().string().clone(),
        None => tag.to_string_ref(cx)?,
    };
    let bag = OptionBag::coerce(cx, options)?;
    let mut locale = with_cache(cx, |cache| Locale::new(cache, &tag))?;
    if !options.is_undefined() {
        locale = locale.with_options(read_options(cx, bag)?).or_throw(cx)?;
    }
    Ok(JsLocale::create(cx, shape, locale))
}

fn read_options(cx: &mut Cx, bag: OptionBag) -> JsResult<Options> {
    let mut options = Options::default();
    bag.parse(cx, names::language, |text| options.set_language(text))?;
    bag.parse(cx, names::script, |text| options.set_script(text))?;
    bag.parse(cx, names::region, |text| options.set_region(text))?;
    bag.parse(cx, names::variants, |text| options.set_variants(text))?;
    options.calendar = bag.parse(cx, names::calendar, KeywordValue::calendar)?;
    options.collation = bag.parse(cx, names::collation, KeywordValue::collation)?;
    bag.parse(cx, names::firstDayOfWeek, |text| {
        options.set_first_day_of_week(text)
    })?;
    options.hour_cycle = bag.value(cx, names::hourCycle)?;
    options.case_first = bag.value(cx, names::caseFirst)?;
    options.numeric = bag.boolean(cx, names::numeric)?;
    options.numbering_system = bag.numbering_system(cx)?;
    Ok(options)
}

macro_rules! methods {
    ($($function:ident $name:literal |$cx:ident, $locale:ident| $body:expr;)*) => {$(
        #[native_abi]
        fn $function($cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
            let this: Gc<JsLocale> = this!($cx, frame.this_value(), "Locale", $name)?;
            let $locale = &this.locale;
            $body
        }
    )*};
}

methods! {
    maximize "maximize" |cx, locale| {
        let maximal = locale.maximize().or_throw(cx)?;
        Ok(JsLocale::create(cx, cx.locale_shape(), maximal))
    };
    minimize "minimize" |cx, locale| {
        let minimal = locale.minimize().or_throw(cx)?;
        Ok(JsLocale::create(cx, cx.locale_shape(), minimal))
    };
    to_string "toString" |cx, locale| Ok(JsString::new(cx, locale.tag().string().clone()).into());
    get_calendars "getCalendars" |cx, locale| {
        strings_to_array(cx, locale.calendars().or_throw(cx)?)
    };
    get_collations "getCollations" |cx, locale| {
        strings_to_array(cx, locale.collations().or_throw(cx)?)
    };
    get_hour_cycles "getHourCycles" |cx, locale| {
        strings_to_array(cx, locale.hour_cycles().or_throw(cx)?)
    };
    get_numbering_systems "getNumberingSystems" |cx, locale| {
        strings_to_array(cx, locale.numbering_systems().or_throw(cx)?)
    };
    get_time_zones "getTimeZones" |cx, locale| match locale.time_zones().or_throw(cx)? {
        Some(zones) => strings_to_array(cx, zones),
        None => Ok(Value::UNDEFINED),
    };
    get_text_info "getTextInfo" |cx, locale| {
        let direction = locale.direction().or_throw(cx)?;
        let info = Record::new(cx);
        info.put_named(names::direction, direction);
        Ok(info.finish())
    };
    get_week_info "getWeekInfo" |cx, locale| {
        let week = locale.week_info().or_throw(cx)?;
        let weekend = week.weekend.iter().map(|&day| Ok(Value::int32(day.into())));
        let weekend = values_to_array(cx, weekend)?;
        let info = Record::new(cx);
        info.put(names::firstDay, Value::int32(week.first_day.into()));
        info.put(names::weekend, weekend);
        Ok(info.finish())
    };
}

macro_rules! string_getters {
    ($($function:ident $name:literal,)*) => {$(
        #[native_abi]
        fn $function(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
            let this: Gc<JsLocale> = this!(cx, this, "Locale", $name)?;
            let string = Option::<StringRef>::from(this.locale.$function());
            Ok(string.map_or(Value::UNDEFINED, |string| JsString::new(cx, string).into()))
        }
    )*};
}

string_getters! {
    base_name "baseName",
    calendar "calendar",
    case_first "caseFirst",
    collation "collation",
    first_day_of_week "firstDayOfWeek",
    hour_cycle "hourCycle",
    numbering_system "numberingSystem",
    language "language",
    script "script",
    region "region",
    variants "variants",
}

#[native_abi]
fn numeric(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let this: Gc<JsLocale> = this!(cx, this, "Locale", "numeric")?;
    Ok(this.locale.is_numeric().into())
}
