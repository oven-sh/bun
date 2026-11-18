use bun_engine_bytecode::Specialization;

use super::{
    DirectForm, bigint, conversion, date, json, math, number, pattern, regexp, search, string,
    symbol, uri,
};
use crate::{InternalFunction, Intrinsic, JsFunction, JsObject, RealmSlot};

macro_rules! forms {
    ($($module:ident: $($name:ident)*;)*) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[repr(u16)]
        #[allow(non_camel_case_types)]
        pub enum Form {
            $($($name,)*)*
        }

        impl Form {
            /// By number.
            pub const ALL: &[Form] = &[$($(Form::$name,)*)*];
        }

        static DESCRIPTIONS: [DirectForm; Form::ALL.len()] = [$($($module::$name::FORM,)*)*];
    };
}

forms! {
    math:
        int32_itself number_itself abs_of_int32 abs sign_of_int32 sign ceil floor round trunc sqrt fround f16round
        acos acosh asin asinh atan atanh cbrt cos cosh exp expm1 log log10 log1p log2 sin sinh tan tanh
        atan2 hypot hypot3 pow_by_squaring pow max_of_int32 max min_of_int32 min imul clz32 random;
    number:
        true_of_int32 false_of_int32 number_is_finite value_is_finite number_is_nan value_is_nan
        number_is_integer value_is_integer number_is_safe_integer value_is_safe_integer
        is_finite_of_number is_finite_of_primitive is_nan_of_number is_nan_of_primitive
        parse_int_of_int32 parse_int_of_number parse_int_of_characters parse_int_of_string parse_int_of_primitive
        parse_float_of_number parse_float_of_characters parse_float_of_string parse_float_of_primitive
        number_of_characters number_of_string number_of_bigint number_of_date number_of_primitive
        int32_to_string int32_to_radix int52_to_radix number_to_string number_to_radix
        this_int32 this_number to_fixed to_precision
        to_integer_or_infinity_of_number to_length_of_int32 to_length_of_number;
    bigint:
        bigint_itself bigint_of_int32 bigint_of_int52 bigint_of_number bigint_of_string
        as_int_n as_uint_n bigint_to_string;
    string:
        char_code_at_in_characters char_code_at code_point_at_in_characters code_point_at char_at at
        from_char_code from_code_point slice substring substr trim trim_start trim_end to_lower_case to_upper_case
        is_well_formed_in_characters is_well_formed to_well_formed
        repeat pad_start_with_spaces pad_start pad_end_with_spaces pad_end locale_compare locale_compare_in
        replace_string_literally replace_string_by_template
        replace_all_strings_literally replace_all_strings_by_template
        this_string this_string_object concat concat_primitive concat_two split string_iterator string_iterator_next;
    search:
        index_of_unit_in_characters index_of_in_characters index_of_unit index_of
        includes_unit_in_characters includes_in_characters includes_unit includes
        last_index_of_unit_in_characters last_index_of_in_characters last_index_of_unit last_index_of
        starts_with_in_characters starts_with ends_with_in_characters ends_with;
    pattern:
        match_once match_every match_plain match_source match_all search search_source split_by_pattern
        replace_once_literally replace_once replace_every_literally replace_every replace_plain;
    conversion:
        string_itself string_of_int32 string_of_number string_of_primitive string_of_symbol string_of_string_object
        new_string_object;
    regexp:
        exec_pattern exec_plain test_pattern test_plain
        symbol_match_once symbol_match_every symbol_match_plain symbol_search symbol_split
        flag_has_indices flag_global flag_ignore_case flag_multiline flag_dot_all flag_unicode flag_unicode_sets
        flag_sticky regexp_source regexp_flags regexp_string_iterator_next
        new_regexp new_regexp_with_flags copy_regexp copy_regexp_with_flags;
    symbol:
        new_symbol new_symbol_with_description symbol_for symbol_to_string;
    json:
        json_parse json_quote;
    uri:
        escape unescape decode_uri decode_uri_component encode_uri encode_uri_component;
    date:
        date_now get_time set_time get_milliseconds get_full_year get_utc_full_year get_month get_utc_month
        get_date get_utc_date get_day get_utc_day get_hours get_utc_hours get_minutes get_utc_minutes
        get_seconds get_utc_seconds get_timezone_offset get_year
        set_full_year1 set_full_year2 set_full_year3 set_utc_full_year1 set_utc_full_year2 set_utc_full_year3
        set_month1 set_month2 set_utc_month1 set_utc_month2 set_date set_utc_date
        set_hours1 set_hours2 set_hours3 set_hours4 set_utc_hours1 set_utc_hours2 set_utc_hours3 set_utc_hours4
        set_minutes1 set_minutes2 set_minutes3 set_utc_minutes1 set_utc_minutes2 set_utc_minutes3
        set_seconds1 set_seconds2 set_utc_seconds1 set_utc_seconds2 set_milliseconds set_utc_milliseconds
        to_iso_string date_to_json date_parse_characters date_parse_string
        new_date_now new_date_at new_date_like new_date_parsed
        new_date2 new_date3 new_date4 new_date5 new_date6 new_date7 utc2 utc3 utc4 utc5 utc6 utc7
        new_date_of_int32s2 new_date_of_int32s3 new_date_of_int32s4 new_date_of_int32s5
        utc_of_int32s2 utc_of_int32s3 utc_of_int32s4 utc_of_int32s5 utc_of_int32s6;
}

impl core::ops::Deref for Form {
    type Target = DirectForm;

    #[inline]
    fn deref(&self) -> &DirectForm {
        &DESCRIPTIONS[*self as usize]
    }
}

/// What a function does with arguments beyond the operands of a form.
enum Row {
    Ignores(&'static [Form]),
    Counts(&'static [Form]),
}

fn called(intrinsic: Intrinsic) -> Row {
    use Form::*;
    use Intrinsic::*;
    use Row::*;
    match intrinsic {
        Abs => Ignores(&[abs_of_int32, abs]),
        ACos => Ignores(&[acos]),
        ACosh => Ignores(&[acosh]),
        ASin => Ignores(&[asin]),
        ASinh => Ignores(&[asinh]),
        ATan => Ignores(&[atan]),
        ATan2 => Ignores(&[atan2]),
        ATanh => Ignores(&[atanh]),
        Cbrt => Ignores(&[cbrt]),
        Ceil => Ignores(&[int32_itself, ceil]),
        Clz32 => Ignores(&[clz32]),
        Cos => Ignores(&[cos]),
        Cosh => Ignores(&[cosh]),
        Exp => Ignores(&[exp]),
        Expm1 => Ignores(&[expm1]),
        F16Round => Ignores(&[f16round]),
        Floor => Ignores(&[int32_itself, floor]),
        FRound => Ignores(&[fround]),
        Hypot => Counts(&[abs, hypot, hypot3]),
        IMul => Ignores(&[imul]),
        Log => Ignores(&[log]),
        Log10 => Ignores(&[log10]),
        Log1p => Ignores(&[log1p]),
        Log2 => Ignores(&[log2]),
        Max => Counts(&[int32_itself, number_itself, max_of_int32, max]),
        Min => Counts(&[int32_itself, number_itself, min_of_int32, min]),
        Pow => Ignores(&[pow_by_squaring, pow]),
        Random => Ignores(&[random]),
        Round => Ignores(&[int32_itself, round]),
        Sign => Ignores(&[sign_of_int32, sign]),
        Sin => Ignores(&[sin]),
        Sinh => Ignores(&[sinh]),
        Sqrt => Ignores(&[sqrt]),
        Tan => Ignores(&[tan]),
        Tanh => Ignores(&[tanh]),
        Trunc => Ignores(&[int32_itself, trunc]),

        GlobalIsFinite => Ignores(&[true_of_int32, is_finite_of_number, is_finite_of_primitive]),
        GlobalIsNaN => Ignores(&[false_of_int32, is_nan_of_number, is_nan_of_primitive]),
        NumberIsFinite => Ignores(&[true_of_int32, number_is_finite, value_is_finite]),
        NumberIsInteger => Ignores(&[true_of_int32, number_is_integer, value_is_integer]),
        NumberIsNaN => Ignores(&[false_of_int32, number_is_nan, value_is_nan]),
        NumberIsSafeInteger => {
            Ignores(&[true_of_int32, number_is_safe_integer, value_is_safe_integer])
        }
        NumberConstructor => Ignores(&[
            int32_itself,
            number_itself,
            number_of_characters,
            number_of_string,
            number_of_bigint,
            number_of_date,
            number_of_primitive,
        ]),
        NumberPrototypeToFixed => Ignores(&[to_fixed]),
        NumberPrototypeToPrecision => Ignores(&[to_precision]),
        NumberPrototypeToString => Ignores(&[
            int32_to_string,
            int32_to_radix,
            number_to_string,
            int52_to_radix,
            number_to_radix,
        ]),
        NumberPrototypeValueOf => Ignores(&[this_int32, this_number]),
        ParseFloat => Ignores(&[
            int32_itself,
            parse_float_of_number,
            parse_float_of_characters,
            parse_float_of_string,
            parse_float_of_primitive,
        ]),
        ParseInt => Ignores(&[
            parse_int_of_int32,
            parse_int_of_number,
            parse_int_of_characters,
            parse_int_of_string,
            parse_int_of_primitive,
        ]),
        ToIntegerOrInfinity => Ignores(&[int32_itself, to_integer_or_infinity_of_number]),
        ToLength => Ignores(&[to_length_of_int32, to_length_of_number]),

        BigIntAsIntN => Ignores(&[as_int_n]),
        BigIntAsUintN => Ignores(&[as_uint_n]),
        BigIntConstructor => Ignores(&[
            bigint_itself,
            bigint_of_int32,
            bigint_of_int52,
            bigint_of_number,
            bigint_of_string,
        ]),
        BigIntPrototypeToString => Ignores(&[bigint_to_string]),

        CharAt => Ignores(&[char_at]),
        CharCodeAt => Ignores(&[char_code_at_in_characters, char_code_at]),
        FromCharCode => Counts(&[from_char_code]),
        FromCodePoint => Counts(&[from_code_point]),
        StringConstructor => Ignores(&[
            string_itself,
            string_of_int32,
            string_of_number,
            string_of_primitive,
            string_of_symbol,
            string_of_string_object,
        ]),
        StringIterator => Ignores(&[string_iterator]),
        StringIteratorNext => Ignores(&[string_iterator_next]),
        StringPrototypeAt => Ignores(&[at]),
        StringPrototypeCodePointAt => Ignores(&[code_point_at_in_characters, code_point_at]),
        StringPrototypeConcat => Counts(&[this_string, concat, concat_primitive, concat_two]),
        StringPrototypeEndsWith => Ignores(&[ends_with_in_characters, ends_with]),
        StringPrototypeIncludes => Ignores(&[
            includes_unit_in_characters,
            includes_in_characters,
            includes_unit,
            includes,
        ]),
        StringPrototypeIndexOf => Ignores(&[
            index_of_unit_in_characters,
            index_of_in_characters,
            index_of_unit,
            index_of,
        ]),
        StringPrototypeIsWellFormed => Ignores(&[is_well_formed_in_characters, is_well_formed]),
        StringPrototypeLastIndexOf => Ignores(&[
            last_index_of_unit_in_characters,
            last_index_of_in_characters,
            last_index_of_unit,
            last_index_of,
        ]),
        StringPrototypeLocaleCompare => Ignores(&[locale_compare, locale_compare_in]),
        StringPrototypeMatch => Ignores(&[match_once, match_every, match_plain, match_source]),
        StringPrototypeMatchAll => Ignores(&[match_all]),
        StringPrototypePadEnd => Ignores(&[pad_end_with_spaces, pad_end]),
        StringPrototypePadStart => Ignores(&[pad_start_with_spaces, pad_start]),
        StringPrototypeRepeat => Ignores(&[repeat]),
        StringPrototypeReplace => Ignores(&[
            replace_string_literally,
            replace_string_by_template,
            replace_once_literally,
            replace_once,
            replace_every_literally,
            replace_every,
            replace_plain,
        ]),
        StringPrototypeReplaceAll => Ignores(&[
            replace_all_strings_literally,
            replace_all_strings_by_template,
            replace_every_literally,
            replace_every,
        ]),
        StringPrototypeSearch => Ignores(&[search, search_source]),
        StringPrototypeSlice => Ignores(&[slice]),
        StringPrototypeSplit => Ignores(&[split, split_by_pattern]),
        StringPrototypeStartsWith => Ignores(&[starts_with_in_characters, starts_with]),
        StringPrototypeSubstr => Ignores(&[substr]),
        StringPrototypeSubstring => Ignores(&[substring]),
        StringPrototypeToLowerCase => Ignores(&[to_lower_case]),
        StringPrototypeToUpperCase => Ignores(&[to_upper_case]),
        StringPrototypeToWellFormed => Ignores(&[to_well_formed]),
        StringPrototypeTrim => Ignores(&[trim]),
        StringPrototypeTrimEnd => Ignores(&[trim_end]),
        StringPrototypeTrimStart => Ignores(&[trim_start]),
        StringPrototypeValueOf => Ignores(&[this_string, this_string_object]),

        DecodeUri => Ignores(&[decode_uri]),
        DecodeUriComponent => Ignores(&[decode_uri_component]),
        EncodeUri => Ignores(&[encode_uri]),
        EncodeUriComponent => Ignores(&[encode_uri_component]),
        Escape => Ignores(&[escape]),
        Unescape => Ignores(&[unescape]),

        JsonParse => Ignores(&[json_parse]),
        JsonStringify => Ignores(&[json_quote]),

        SymbolConstructor => Ignores(&[new_symbol, new_symbol_with_description]),
        SymbolFor => Ignores(&[symbol_for]),
        SymbolPrototypeToString => Ignores(&[symbol_to_string]),

        DateNow => Ignores(&[date_now]),
        DateParse => Ignores(&[date_parse_characters, date_parse_string]),
        DatePrototypeGetDate => Ignores(&[get_date]),
        DatePrototypeGetDay => Ignores(&[get_day]),
        DatePrototypeGetFullYear => Ignores(&[get_full_year]),
        DatePrototypeGetHours => Ignores(&[get_hours]),
        DatePrototypeGetMilliseconds => Ignores(&[get_milliseconds]),
        DatePrototypeGetMinutes => Ignores(&[get_minutes]),
        DatePrototypeGetMonth => Ignores(&[get_month]),
        DatePrototypeGetSeconds => Ignores(&[get_seconds]),
        DatePrototypeGetTime => Ignores(&[get_time]),
        DatePrototypeGetTimezoneOffset => Ignores(&[get_timezone_offset]),
        DatePrototypeGetUTCDate => Ignores(&[get_utc_date]),
        DatePrototypeGetUTCDay => Ignores(&[get_utc_day]),
        DatePrototypeGetUTCFullYear => Ignores(&[get_utc_full_year]),
        DatePrototypeGetUTCHours => Ignores(&[get_utc_hours]),
        DatePrototypeGetUTCMilliseconds => Ignores(&[get_milliseconds]),
        DatePrototypeGetUTCMinutes => Ignores(&[get_utc_minutes]),
        DatePrototypeGetUTCMonth => Ignores(&[get_utc_month]),
        DatePrototypeGetUTCSeconds => Ignores(&[get_utc_seconds]),
        DatePrototypeGetYear => Ignores(&[get_year]),
        DatePrototypeSetDate => Ignores(&[set_date]),
        DatePrototypeSetFullYear => Counts(&[set_full_year1, set_full_year2, set_full_year3]),
        DatePrototypeSetHours => Counts(&[set_hours1, set_hours2, set_hours3, set_hours4]),
        DatePrototypeSetMilliseconds => Ignores(&[set_milliseconds]),
        DatePrototypeSetMinutes => Counts(&[set_minutes1, set_minutes2, set_minutes3]),
        DatePrototypeSetMonth => Counts(&[set_month1, set_month2]),
        DatePrototypeSetSeconds => Counts(&[set_seconds1, set_seconds2]),
        DatePrototypeSetTime => Ignores(&[set_time]),
        DatePrototypeSetUTCDate => Ignores(&[set_utc_date]),
        DatePrototypeSetUTCFullYear => {
            Counts(&[set_utc_full_year1, set_utc_full_year2, set_utc_full_year3])
        }
        DatePrototypeSetUTCHours => Counts(&[
            set_utc_hours1,
            set_utc_hours2,
            set_utc_hours3,
            set_utc_hours4,
        ]),
        DatePrototypeSetUTCMilliseconds => Ignores(&[set_utc_milliseconds]),
        DatePrototypeSetUTCMinutes => {
            Counts(&[set_utc_minutes1, set_utc_minutes2, set_utc_minutes3])
        }
        DatePrototypeSetUTCMonth => Counts(&[set_utc_month1, set_utc_month2]),
        DatePrototypeSetUTCSeconds => Counts(&[set_utc_seconds1, set_utc_seconds2]),
        DatePrototypeToISOString => Ignores(&[to_iso_string]),
        DatePrototypeToJSON => Ignores(&[date_to_json]),
        DateUTC => Counts(&[
            utc_of_int32s2,
            utc_of_int32s3,
            utc_of_int32s4,
            utc_of_int32s5,
            utc_of_int32s6,
            utc2,
            utc3,
            utc4,
            utc5,
            utc6,
            utc7,
        ]),

        RegExpConstructor => Ignores(&[new_regexp, new_regexp_with_flags]),
        RegExpDotAll => Ignores(&[flag_dot_all]),
        RegExpExec => Ignores(&[exec_pattern, exec_plain]),
        RegExpFlags => Ignores(&[regexp_flags]),
        RegExpGlobal => Ignores(&[flag_global]),
        RegExpHasIndices => Ignores(&[flag_has_indices]),
        RegExpIgnoreCase => Ignores(&[flag_ignore_case]),
        RegExpMatch => Ignores(&[symbol_match_once, symbol_match_every, symbol_match_plain]),
        RegExpMultiline => Ignores(&[flag_multiline]),
        RegExpSearch => Ignores(&[symbol_search]),
        RegExpSource => Ignores(&[regexp_source]),
        RegExpSplit => Ignores(&[symbol_split]),
        RegExpSticky => Ignores(&[flag_sticky]),
        RegExpStringIteratorNext => Ignores(&[regexp_string_iterator_next]),
        RegExpTest => Ignores(&[test_pattern, test_plain]),
        RegExpUnicode => Ignores(&[flag_unicode]),
        RegExpUnicodeSets => Ignores(&[flag_unicode_sets]),
        _ => Ignores(&[]),
    }
}

fn constructed(intrinsic: Intrinsic) -> Row {
    use Form::*;
    use Intrinsic::*;
    use Row::*;
    match intrinsic {
        DateConstructor => Counts(&[
            new_date_now,
            new_date_at,
            new_date_like,
            new_date_parsed,
            new_date_of_int32s2,
            new_date_of_int32s3,
            new_date_of_int32s4,
            new_date_of_int32s5,
            new_date2,
            new_date3,
            new_date4,
            new_date5,
            new_date6,
            new_date7,
        ]),
        RegExpConstructor => Ignores(&[
            new_regexp,
            new_regexp_with_flags,
            copy_regexp,
            copy_regexp_with_flags,
        ]),
        StringConstructor => Ignores(&[new_string_object]),
        _ => Ignores(&[]),
    }
}

/// Those that suit a call with so many arguments, the most specific first. `new.target` is the callee.
pub fn forms_for(
    intrinsic: Intrinsic,
    specialization: Specialization,
    argument_count: usize,
) -> impl Iterator<Item = Form> {
    let row = match specialization {
        Specialization::Call => called(intrinsic),
        Specialization::Construct => constructed(intrinsic),
    };
    let (forms, most) = match row {
        Row::Ignores(forms) => (forms, 0),
        Row::Counts(forms) => (forms, argument_count),
    };
    forms.iter().copied().filter(move |form| {
        let arguments = form.arguments();
        let mut missing = arguments.iter().skip(argument_count);
        most <= arguments.len() && missing.all(|it| it.kind.can_be_missing())
    })
}

/// Also of the constructors that have no executable of their own to say so.
pub fn intrinsic_of(callee: &JsObject) -> Intrinsic {
    if let Some(function) = callee.downcast::<JsFunction>() {
        return function.intrinsic();
    }
    let is_in = |slot| {
        let function = callee.downcast::<InternalFunction>();
        function.is_some_and(|it| it.global().slot_if_initialized(slot) == Some(it.cell()))
    };
    [
        (RealmSlot::bigint_constructor, Intrinsic::BigIntConstructor),
        (RealmSlot::date_constructor, Intrinsic::DateConstructor),
        (RealmSlot::regexp_constructor, Intrinsic::RegExpConstructor),
        (RealmSlot::symbol_constructor, Intrinsic::SymbolConstructor),
    ]
    .into_iter()
    .find_map(|(slot, intrinsic)| is_in(slot).then_some(intrinsic))
    .unwrap_or(Intrinsic::None)
}
