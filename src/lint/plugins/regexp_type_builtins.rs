#![allow(dead_code)] // until every rule of the plugin is written
//! The tables of eslint-plugin-regexp's type tracker (`lib/utils/type-tracker/type-data`): which
//! property of which builtin has which type. What a [`Proto`] does is in `regexp_type_data`.

/// Whose table. That of a constructor is its `*_TYPES` alone: `TypeGlobalFunction.propertyType`
/// asks `Function` for what is not there.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Class {
    String,
    Number,
    Boolean,
    BigInt,
    RegExp,
    Array,
    Map,
    Set,
    Object,
    Function,
    Iterable,
    Global,
    StringConstructor,
    NumberConstructor,
    BooleanConstructor,
    RegExpConstructor,
    BigIntConstructor,
    ArrayConstructor,
    ObjectConstructor,
    FunctionConstructor,
    MapConstructor,
    SetConstructor,
}

/// A value of the tables. Two entries hold one object upstream (`===`, which `isEquals` and
/// `TypeCollection.all` ask) exactly if they hold one variant here.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Proto {
    /// `STRING`
    String,
    /// `NUMBER`
    Number,
    /// `BOOLEAN`
    Boolean,
    /// `"undefined"`
    Undefined,
    /// `GLOBAL`
    Global,
    // function.ts
    UnknownFunction,
    ReturnVoid,
    ReturnString,
    ReturnNumber,
    ReturnBoolean,
    ReturnUnknownArray,
    ReturnStringArray,
    ReturnUnknownObject,
    ReturnRegExp,
    ReturnBigInt,
    ReturnSelf,
    // array.ts
    ReturnArrayElement,
    /// `RETURN_SELF` of array.ts
    ReturnArraySelf,
    ReturnConcat,
    ReturnEntries,
    ReturnKeys,
    ReturnValues,
    ReturnMap,
    // map.ts
    ReturnMapValue,
    /// `RETURN_SELF` of map.ts, and so on
    ReturnMapSelf,
    ReturnMapEntries,
    ReturnMapKeys,
    ReturnMapValues,
    // set.ts
    ReturnSetSelf,
    ReturnSetEntries,
    ReturnSetKeys,
    ReturnSetValues,
    // object.ts
    ReturnArg,
    ReturnAssign,
    /// What `buildStringConstructor()` and the like give.
    Constructor(Class),
}

/// `table[name] || null`. An entry that is `null` upstream is absent, and so is a symbol's.
pub(crate) fn property(class: Class, name: &[u8]) -> Option<Proto> {
    match class {
        Class::String => string_prototypes(name),
        Class::Number => number_prototypes(name),
        Class::Boolean => boolean_prototypes(name),
        Class::BigInt => bigint_prototypes(name),
        Class::RegExp => regexp_prototypes(name),
        Class::Array => array_prototypes(name),
        Class::Map => map_prototypes(name),
        Class::Set => set_prototypes(name),
        // `getPrototypes` of iterable.ts adds a symbol and nothing else.
        Class::Object | Class::Iterable => get_object_prototypes(name),
        Class::Function => function_prototypes(name),
        Class::Global => get_properties(name),
        Class::StringConstructor => string_types(name),
        Class::NumberConstructor => number_types(name),
        Class::RegExpConstructor => regexp_types(name),
        Class::BigIntConstructor => bigint_types(name),
        Class::ArrayConstructor => array_types(name),
        Class::ObjectConstructor => object_types(name),
        // `BOOLEAN_TYPES`, `FUNCTION_TYPES`, `MAP_TYPES`, `SET_TYPES`: all of it is `null`.
        Class::BooleanConstructor
        | Class::FunctionConstructor
        | Class::MapConstructor
        | Class::SetConstructor => None,
    }
}

/// upstream's `STRING_TYPES`
fn string_types(name: &[u8]) -> Option<Proto> {
    match name {
        b"fromCharCode" | b"fromCodePoint" | b"raw" => Some(Proto::ReturnString),
        _ => None,
    }
}

/// upstream's `getPrototypes` of string.ts. `null`: `matchAll`.
fn string_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"toString" | b"charAt" | b"concat" | b"replace" | b"slice" | b"substring"
        | b"toLowerCase" | b"toLocaleLowerCase" | b"toUpperCase" | b"toLocaleUpperCase"
        | b"trim" | b"substr" | b"valueOf" | b"normalize" | b"repeat" | b"anchor" | b"big"
        | b"blink" | b"bold" | b"fixed" | b"fontcolor" | b"fontsize" | b"italics" | b"link"
        | b"small" | b"strike" | b"sub" | b"sup" | b"padStart" | b"padEnd" | b"trimLeft"
        | b"trimRight" | b"trimStart" | b"trimEnd" | b"replaceAll" | b"at" | b"toWellFormed" => {
            Proto::ReturnString
        }
        b"charCodeAt" | b"indexOf" | b"lastIndexOf" | b"localeCompare" | b"search"
        | b"codePointAt" => Proto::ReturnNumber,
        b"match" | b"split" => Proto::ReturnStringArray,
        b"includes" | b"endsWith" | b"startsWith" | b"isWellFormed" => Proto::ReturnBoolean,
        b"length" => Proto::Number,
        b"0" => Proto::String,
        _ => return get_object_prototypes(name),
    })
}

/// upstream's `NUMBER_TYPES`
fn number_types(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"MAX_VALUE" | b"MIN_VALUE" | b"NaN" | b"NEGATIVE_INFINITY" | b"POSITIVE_INFINITY"
        | b"EPSILON" | b"MAX_SAFE_INTEGER" | b"MIN_SAFE_INTEGER" => Proto::Number,
        b"isFinite" | b"isInteger" | b"isNaN" | b"isSafeInteger" => Proto::ReturnBoolean,
        b"parseFloat" | b"parseInt" => Proto::ReturnNumber,
        _ => return None,
    })
}

/// upstream's `getPrototypes` of number.ts
fn number_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"toString" | b"toFixed" | b"toExponential" | b"toPrecision" | b"toLocaleString" => {
            Proto::ReturnString
        }
        b"valueOf" => Proto::ReturnNumber,
        _ => return get_object_prototypes(name),
    })
}

/// upstream's `getPrototypes` of boolean.ts
fn boolean_prototypes(name: &[u8]) -> Option<Proto> {
    match name {
        b"valueOf" => Some(Proto::ReturnBoolean),
        _ => get_object_prototypes(name),
    }
}

/// upstream's `BIGINT_TYPES`
fn bigint_types(name: &[u8]) -> Option<Proto> {
    match name {
        b"asIntN" | b"asUintN" => Some(Proto::ReturnBigInt),
        _ => None,
    }
}

/// upstream's `getPrototypes` of bigint.ts
fn bigint_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"toString" | b"toLocaleString" => Proto::ReturnString,
        b"valueOf" => Proto::ReturnBigInt,
        _ => return get_object_prototypes(name),
    })
}

/// upstream's `REGEXP_TYPES`
fn regexp_types(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"$1" | b"$2" | b"$3" | b"$4" | b"$5" | b"$6" | b"$7" | b"$8" | b"$9" | b"$_" | b"$&"
        | b"$+" | b"$`" | b"$'" | b"input" | b"lastParen" | b"leftContext" | b"rightContext" => {
            Proto::String
        }
        b"lastMatch" => Proto::Number,
        _ => return None,
    })
}

/// upstream's `getPrototypes` of regexp.ts
fn regexp_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"exec" => Proto::ReturnStringArray,
        b"test" => Proto::ReturnBoolean,
        b"source" | b"flags" => Proto::String,
        b"global" | b"ignoreCase" | b"multiline" | b"sticky" | b"unicode" | b"dotAll"
        | b"hasIndices" | b"unicodeSets" => Proto::Boolean,
        b"lastIndex" => Proto::Number,
        b"compile" => Proto::ReturnRegExp,
        _ => return get_object_prototypes(name),
    })
}

/// upstream's `ARRAY_TYPES`. `null`: `fromAsync`.
fn array_types(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"isArray" => Proto::ReturnBoolean,
        b"from" | b"of" => Proto::ReturnUnknownArray,
        _ => return None,
    })
}

/// upstream's `getPrototypes` of array.ts. `null`: `reduce`, `reduceRight`, `0`.
fn array_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"toString" | b"toLocaleString" | b"join" => Proto::ReturnString,
        b"pop" | b"shift" | b"find" | b"at" | b"findLast" => Proto::ReturnArrayElement,
        b"push" | b"unshift" | b"indexOf" | b"lastIndexOf" | b"findIndex" | b"findLastIndex" => {
            Proto::ReturnNumber
        }
        b"concat" => Proto::ReturnConcat,
        b"reverse" | b"slice" | b"sort" | b"splice" | b"filter" | b"copyWithin" | b"toReversed"
        | b"toSorted" | b"toSpliced" | b"with" => Proto::ReturnArraySelf,
        b"every" | b"some" | b"includes" => Proto::ReturnBoolean,
        b"forEach" => Proto::ReturnVoid,
        b"map" => Proto::ReturnMap,
        b"fill" | b"flatMap" | b"flat" => Proto::ReturnUnknownArray,
        b"entries" => Proto::ReturnEntries,
        b"keys" => Proto::ReturnKeys,
        b"values" => Proto::ReturnValues,
        b"length" => Proto::Number,
        _ => return get_object_prototypes(name),
    })
}

/// upstream's `getPrototypes` of map.ts
fn map_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"clear" | b"forEach" => Proto::ReturnVoid,
        b"delete" | b"has" => Proto::ReturnBoolean,
        b"get" => Proto::ReturnMapValue,
        b"set" => Proto::ReturnMapSelf,
        b"size" => Proto::Number,
        b"entries" => Proto::ReturnMapEntries,
        b"keys" => Proto::ReturnMapKeys,
        b"values" => Proto::ReturnMapValues,
        _ => return get_object_prototypes(name),
    })
}

/// upstream's `getPrototypes` of set.ts
fn set_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"clear" | b"forEach" => Proto::ReturnVoid,
        b"delete" | b"has" | b"isDisjointFrom" | b"isSubsetOf" | b"isSupersetOf" => {
            Proto::ReturnBoolean
        }
        b"add" | b"difference" | b"intersection" | b"symmetricDifference" | b"union" => {
            Proto::ReturnSetSelf
        }
        b"size" => Proto::Number,
        b"entries" => Proto::ReturnSetEntries,
        b"keys" => Proto::ReturnSetKeys,
        b"values" => Proto::ReturnSetValues,
        _ => return get_object_prototypes(name),
    })
}

/// upstream's `getObjectPrototypes`
fn get_object_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"constructor" => Proto::UnknownFunction,
        b"toString" | b"toLocaleString" => Proto::ReturnString,
        b"valueOf" => Proto::ReturnUnknownObject,
        b"hasOwnProperty" | b"isPrototypeOf" | b"propertyIsEnumerable" => Proto::ReturnBoolean,
        _ => return None,
    })
}

/// upstream's `OBJECT_TYPES`. `null`: `getPrototypeOf`, `getOwnPropertyDescriptor`, `create`,
/// `defineProperty` and whatever else is not here.
fn object_types(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"getOwnPropertyNames" | b"keys" => Proto::ReturnStringArray,
        b"seal" | b"freeze" => Proto::ReturnArg,
        b"isSealed" | b"isFrozen" | b"isExtensible" | b"is" | b"hasOwn" => Proto::ReturnBoolean,
        b"assign" => Proto::ReturnAssign,
        b"getOwnPropertySymbols" | b"values" | b"entries" => Proto::ReturnUnknownArray,
        _ => return None,
    })
}

/// upstream's `getPrototypes` of function.ts. `null`: `arguments`, `prototype`.
fn function_prototypes(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"toString" => Proto::ReturnString,
        b"bind" => Proto::ReturnSelf,
        b"length" => Proto::Number,
        b"name" => Proto::String,
        b"apply" | b"call" | b"caller" => Proto::UnknownFunction,
        _ => return get_object_prototypes(name),
    })
}

/// upstream's `getProperties` of global.ts
fn get_properties(name: &[u8]) -> Option<Proto> {
    Some(match name {
        b"String" => Proto::Constructor(Class::StringConstructor),
        b"Number" => Proto::Constructor(Class::NumberConstructor),
        b"Boolean" => Proto::Constructor(Class::BooleanConstructor),
        b"RegExp" => Proto::Constructor(Class::RegExpConstructor),
        b"BigInt" => Proto::Constructor(Class::BigIntConstructor),
        b"Array" => Proto::Constructor(Class::ArrayConstructor),
        b"Object" => Proto::Constructor(Class::ObjectConstructor),
        b"Function" => Proto::Constructor(Class::FunctionConstructor),
        b"Map" => Proto::Constructor(Class::MapConstructor),
        b"Set" => Proto::Constructor(Class::SetConstructor),
        b"isFinite" | b"isNaN" => Proto::ReturnBoolean,
        b"parseFloat" | b"parseInt" => Proto::ReturnNumber,
        b"decodeURI"
        | b"decodeURIComponent"
        | b"encodeURI"
        | b"encodeURIComponent"
        | b"escape"
        | b"unescape" => Proto::ReturnString,
        b"globalThis" | b"window" | b"self" | b"global" => Proto::Global,
        b"undefined" => Proto::Undefined,
        b"Infinity" | b"NaN" => Proto::Number,
        _ => return None,
    })
}
