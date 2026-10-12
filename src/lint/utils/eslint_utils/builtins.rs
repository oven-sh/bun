//! The part of the standard library that [`get_static_value`](super::get_static_value) knows:
//! what exists, and what may be called.

use super::static_value::{Eval, PropertyKey, StaticSymbol, StaticValue, Stop};
use bun_core::strings;
use std::f64::consts;

#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) enum Member {
    /// A function in upstream's `callAllowed`.
    Call,
    /// A function in upstream's `callPassThrough`: a call has the value of its first argument.
    PassThrough,
    /// Any other function. A call of it has no static value.
    Function,
    /// An object that is not a function.
    Namespace,
    /// The `prototype` of a constructor.
    Prototype,
    /// The same function as the member of that owner and name.
    Alias(&'static str, &'static str),
    /// A number.
    Constant(f64),
    /// A well-known symbol.
    Symbol,
    /// An accessor property that is not in upstream's `getterAllowed`.
    Getter,
    /// It exists, with a value that is not represented here.
    Opaque,
}

struct Entry {
    /// `""` for a global variable.
    owner: &'static str,
    name: &'static str,
    /// `owner.name`
    path: &'static str,
    member: Member,
}

macro_rules! entries {
    ($($owner:literal { $($member:expr => $($name:ident)+;)+ })+) => {
        &[$($($(Entry {
            owner: $owner,
            name: stringify!($name),
            path: concat!($owner, ".", stringify!($name)),
            member: {
                use Member::*;
                $member
            },
        },)+)+)+]
    };
}

/// The global variables in upstream's `builtinNames`, but for `undefined`, `NaN` and `Infinity`,
/// and all the properties of those that are looked into.
static ENTRIES: &[Entry] = entries! {
    "" {
        Call => BigInt Boolean Date decodeURI decodeURIComponent encodeURI encodeURIComponent escape isFinite isNaN
            isPrototypeOf Map Number Object parseFloat parseInt RegExp Set String unescape;
        Function => Array ArrayBuffer BigInt64Array BigUint64Array DataView Float32Array Float64Array Function Int16Array
            Int32Array Int8Array Promise Proxy Symbol Uint16Array Uint32Array Uint8Array Uint8ClampedArray WeakMap WeakSet;
        Namespace => JSON Math Reflect;
    }
    "Array" {
        Call => isArray of;
        Function => from fromAsync;
        Prototype => prototype;
    }
    "Array.prototype" {
        Call => at concat entries every filter find findIndex flat includes indexOf join keys lastIndexOf slice some toString
            values;
        Function => copyWithin fill findLast findLastIndex flatMap forEach map pop push reduce reduceRight reverse shift sort
            splice toLocaleString toReversed toSorted toSpliced unshift with;
    }
    "ArrayBuffer" {
        Function => isView;
    }
    "BigInt" {
        Function => asIntN asUintN;
        Prototype => prototype;
    }
    "BigInt.prototype" {
        Function => toLocaleString toString valueOf;
    }
    "Boolean" {
        Prototype => prototype;
    }
    "Boolean.prototype" {
        Function => toString valueOf;
    }
    "Date" {
        Call => parse;
        Function => now UTC;
    }
    "Function.prototype" {
        Function => apply bind call toString;
        Getter => arguments caller;
        Opaque => length name prototype;
    }
    "JSON" {
        Function => isRawJSON parse rawJSON stringify;
    }
    "Map" {
        Function => groupBy;
        Prototype => prototype;
    }
    "Map.prototype" {
        Call => entries get has keys values;
        Function => clear delete forEach getOrInsert getOrInsertComputed set;
        Getter => size;
    }
    "Math" {
        Call => abs acos acosh asin asinh atan atan2 atanh cbrt ceil clz32 cos cosh exp expm1 f16round floor fround hypot imul
            log log10 log1p log2 max min pow round sign sin sinh sqrt tan tanh trunc;
        Function => random;
        Constant(consts::E) => E;
        Constant(consts::LN_10) => LN10;
        Constant(consts::LN_2) => LN2;
        Constant(consts::LOG10_E) => LOG10E;
        Constant(consts::LOG2_E) => LOG2E;
        Constant(consts::PI) => PI;
        Constant(consts::FRAC_1_SQRT_2) => SQRT1_2;
        Constant(consts::SQRT_2) => SQRT2;
    }
    "Number" {
        Call => isFinite isNaN;
        Alias("", "parseFloat") => parseFloat;
        Alias("", "parseInt") => parseInt;
        Function => isInteger isSafeInteger;
        Constant(f64::EPSILON) => EPSILON;
        Constant(9_007_199_254_740_991.0) => MAX_SAFE_INTEGER;
        Constant(f64::MAX) => MAX_VALUE;
        Constant(-9_007_199_254_740_991.0) => MIN_SAFE_INTEGER;
        Constant(5e-324) => MIN_VALUE;
        Constant(f64::NAN) => NaN;
        Constant(f64::NEG_INFINITY) => NEGATIVE_INFINITY;
        Constant(f64::INFINITY) => POSITIVE_INFINITY;
        Prototype => prototype;
    }
    "Number.prototype" {
        Call => toExponential toFixed toPrecision toString;
        Function => toLocaleString valueOf;
    }
    "Object" {
        Call => entries is isExtensible isFrozen isSealed keys values;
        PassThrough => freeze preventExtensions seal;
        Function => assign create defineProperties defineProperty fromEntries getOwnPropertyDescriptor
            getOwnPropertyDescriptors getOwnPropertyNames getOwnPropertySymbols getPrototypeOf groupBy hasOwn setPrototypeOf;
        Prototype => prototype;
    }
    "Object.prototype" {
        Alias("", "isPrototypeOf") => isPrototypeOf;
        Function => __defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ hasOwnProperty propertyIsEnumerable
            toLocaleString toString valueOf;
        Getter => __proto__;
    }
    "Promise" {
        Function => all allSettled any race reject resolve try withResolvers;
    }
    "Proxy" {
        Function => revocable;
    }
    "Reflect" {
        Function => apply construct defineProperty deleteProperty get getOwnPropertyDescriptor getPrototypeOf has isExtensible
            ownKeys preventExtensions set setPrototypeOf;
    }
    "RegExp" {
        Function => escape;
        Getter => input lastMatch lastParen leftContext rightContext;
        Prototype => prototype;
    }
    "RegExp.prototype" {
        Function => compile exec test toString;
        Getter => dotAll flags global hasIndices ignoreCase multiline source sticky unicode unicodeSets;
    }
    "Set" {
        Prototype => prototype;
    }
    "Set.prototype" {
        Call => entries has values;
        Alias("Set.prototype", "values") => keys;
        Function => add clear delete difference forEach intersection isDisjointFrom isSubsetOf isSupersetOf symmetricDifference
            union;
        Getter => size;
    }
    "String" {
        Call => fromCharCode fromCodePoint raw;
        Prototype => prototype;
    }
    "String.prototype" {
        Call => at charAt charCodeAt codePointAt concat endsWith includes indexOf lastIndexOf normalize padEnd padStart slice
            startsWith substr substring toLowerCase toString toUpperCase trim trimEnd trimStart;
        Alias("String.prototype", "trimStart") => trimLeft;
        Alias("String.prototype", "trimEnd") => trimRight;
        Function => anchor big blink bold fixed fontcolor fontsize isWellFormed italics link localeCompare match matchAll
            repeat replace replaceAll search small split strike sub sup toLocaleLowerCase toLocaleUpperCase toWellFormed
            valueOf;
    }
    "Symbol" {
        Call => for keyFor;
        Symbol => asyncDispose asyncIterator dispose hasInstance isConcatSpreadable iterator match matchAll replace search
            species split toPrimitive toStringTag unscopables;
        Prototype => prototype;
    }
    "Symbol.prototype" {
        Function => toString valueOf;
        Getter => description;
    }
};

fn find(owner: &str, name: &[u8]) -> Option<usize> {
    (ENTRIES.iter()).position(|entry| entry.name.as_bytes() == name && entry.owner == owner)
}

/// A function or an object of the standard library.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct Builtin(u16);

impl std::fmt::Debug for Builtin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name())
    }
}

impl Builtin {
    fn entry(self) -> Option<&'static Entry> {
        ENTRIES.get(usize::from(self.0))
    }

    /// How to get at it: `"Math"`, `"Math.max"`, `"String.prototype.trim"`.
    pub fn name(self) -> &'static str {
        let path = self.entry().map_or("", |entry| entry.path);
        path.strip_prefix('.').unwrap_or(path)
    }

    /// `typeof value === "function"`
    pub fn is_callable(self) -> bool {
        !matches!(self.member(), Member::Namespace | Member::Prototype)
    }

    /// `Array.prototype` and the like. They are of the kind that they are the prototype of: an
    /// array, a string, ..
    pub(super) fn is_prototype(self) -> bool {
        self.member() == Member::Prototype
    }

    pub(super) fn member(self) -> Member {
        self.entry().map_or(Member::Opaque, |entry| entry.member)
    }
}

/// The value of the global variable `name`, if it is in upstream's `builtinNames`.
pub(super) fn global_value(name: &[u8]) -> Option<StaticValue<'static>> {
    match name {
        b"undefined" => Some(StaticValue::Undefined),
        b"NaN" => Some(StaticValue::Number(f64::NAN)),
        b"Infinity" => Some(StaticValue::Number(f64::INFINITY)),
        _ => Some(StaticValue::Builtin(Builtin(find("", name)? as u16))),
    }
}

fn value_of(at: usize) -> Eval<StaticValue<'static>> {
    let entry = ENTRIES.get(at).ok_or(Stop::Abort)?;
    match entry.member {
        Member::Call
        | Member::PassThrough
        | Member::Function
        | Member::Namespace
        | Member::Prototype => Ok(StaticValue::Builtin(Builtin(at as u16))),
        Member::Alias(owner, name) => value_of(find(owner, name.as_bytes()).ok_or(Stop::Abort)?),
        Member::Constant(value) => Ok(StaticValue::Number(value)),
        Member::Symbol => Ok(StaticValue::Symbol(StaticSymbol::WellKnown(entry.name))),
        Member::Getter => Err(Stop::NotStatic),
        Member::Opaque => Err(Stop::Abort),
    }
}

/// The property `name` of an object whose own properties do not include it, whose prototype is
/// `constructor.prototype`, and the prototype of that `Object.prototype`.
fn inherited(
    constructor: &'static str,
    prototype: &'static str,
    name: &[u8],
) -> Eval<StaticValue<'static>> {
    if name == b"constructor" {
        return value_of(find("", constructor.as_bytes()).ok_or(Stop::Abort)?);
    }
    match find(prototype, name).or_else(|| find("Object.prototype", name)) {
        Some(at) => value_of(at),
        None => Ok(StaticValue::Undefined),
    }
}

/// `object[key]`, where upstream allows it: a getter that is not in `getterAllowed` is not run.
pub(super) fn get_member<'a>(
    object: &StaticValue<'a>,
    key: &PropertyKey<'a>,
) -> Eval<StaticValue<'a>> {
    let name = match key {
        PropertyKey::String(name) => &**name,
        PropertyKey::Symbol(symbol) => {
            return match (object, symbol) {
                (StaticValue::Undefined | StaticValue::Null | StaticValue::Hole, _) => {
                    Err(Stop::Abort)
                }
                (StaticValue::Object(properties), _) => {
                    Ok(own_property(properties, key).unwrap_or(StaticValue::Undefined))
                }
                (StaticValue::Wrapper(primitive), _) => get_member(primitive, key),
                (_, StaticSymbol::Registered(_)) => Ok(StaticValue::Undefined),
                // The prototypes and the constructors have properties that are named by these.
                (_, StaticSymbol::WellKnown(_)) => Err(Stop::Abort),
            };
        }
    };
    let flag = |flags: &[u8], flag: u8| Ok(StaticValue::Bool(strings::contains_char(flags, flag)));
    match object {
        StaticValue::Undefined
        | StaticValue::Null
        | StaticValue::Hole
        | StaticValue::Iterator(..) => Err(Stop::Abort),
        // On an object it is seen to be a getter.
        StaticValue::Wrapper(primitive)
            if name == b"description" && primitive.as_symbol().is_some() =>
        {
            Err(Stop::NotStatic)
        }
        StaticValue::Wrapper(primitive) => get_member(primitive, key),
        StaticValue::Bool(_) => inherited("Boolean", "Boolean.prototype", name),
        StaticValue::Number(_) => inherited("Number", "Number.prototype", name),
        StaticValue::BigInt(_) => inherited("BigInt", "BigInt.prototype", name),
        StaticValue::Symbol(symbol) => match name {
            b"description" => Ok(StaticValue::string(symbol.description().into_owned())),
            _ => inherited("Symbol", "Symbol.prototype", name),
        },
        StaticValue::String(text) => {
            if name == b"length" {
                return Ok(StaticValue::Number(
                    strings::element_length_utf8_into_utf16(text) as f64,
                ));
            }
            match key.as_index() {
                Some(index) => Ok(match strings::wtf8_to_utf16(text).get(index) {
                    Some(&unit) => StaticValue::string(strings::wtf16_to_wtf8(&[unit])),
                    None => StaticValue::Undefined,
                }),
                None => inherited("String", "String.prototype", name),
            }
        }
        StaticValue::Array(items) => {
            if name == b"length" {
                return Ok(StaticValue::Number(items.len() as f64));
            }
            match key.as_index() {
                Some(index) => Ok(match items.get(index) {
                    None | Some(StaticValue::Hole) => StaticValue::Undefined,
                    Some(item) => item.clone(),
                }),
                None => inherited("Array", "Array.prototype", name),
            }
        }
        StaticValue::Object(properties) => match own_property(properties, key) {
            Some(value) => Ok(value),
            None => inherited("Object", "Object.prototype", name),
        },
        StaticValue::Regex { pattern, flags } => match name {
            b"source" => Ok(StaticValue::String(pattern.clone())),
            b"flags" => Ok(StaticValue::String(flags.clone())),
            b"dotAll" => flag(flags, b's'),
            b"global" => flag(flags, b'g'),
            b"hasIndices" => flag(flags, b'd'),
            b"ignoreCase" => flag(flags, b'i'),
            b"multiline" => flag(flags, b'm'),
            b"sticky" => flag(flags, b'y'),
            b"unicode" => flag(flags, b'u'),
            b"lastIndex" => Ok(StaticValue::Number(0.0)),
            _ => inherited("RegExp", "RegExp.prototype", name),
        },
        StaticValue::Map(entries) => match name {
            b"size" => Ok(StaticValue::Number(entries.len() as f64)),
            _ => inherited("Map", "Map.prototype", name),
        },
        StaticValue::Set(items) => match name {
            b"size" => Ok(StaticValue::Number(items.len() as f64)),
            _ => inherited("Set", "Set.prototype", name),
        },
        StaticValue::Builtin(builtin) => {
            let path = builtin.name();
            if let Some(at) = find(path, name) {
                return value_of(at);
            }
            if path == "RegExp" && name.starts_with(b"$") {
                return Err(Stop::NotStatic);
            }
            if name == b"name" && builtin.is_callable() {
                return Ok(StaticValue::string(
                    builtin.entry().map_or("", |entry| entry.name).as_bytes(),
                ));
            }
            // Only constructors have one.
            let is_constructor = path != "Proxy"
                && !strings::contains_char(path.as_bytes(), b'.')
                && path.starts_with(|c: char| c.is_ascii_uppercase());
            if name == b"prototype" && builtin.is_callable() && !is_constructor {
                return Ok(StaticValue::Undefined);
            }
            if builtin.member() == Member::Prototype {
                let constructor = path.strip_suffix(".prototype").unwrap_or(path);
                return match name {
                    // An array and a string, which are empty.
                    b"length" if matches!(constructor, "Array" | "String") => {
                        Ok(StaticValue::Number(0.0))
                    }
                    _ => inherited(constructor, "Object.prototype", name),
                };
            }
            // Whether all the properties of this one are listed.
            let is_known = !is_constructor
                || builtin.member() != Member::Function
                || matches!(
                    path,
                    "Array"
                        | "ArrayBuffer"
                        | "DataView"
                        | "Function"
                        | "Promise"
                        | "Symbol"
                        | "WeakMap"
                        | "WeakSet"
                );
            match (is_known, builtin.is_callable()) {
                (false, _) => Err(Stop::Abort),
                (true, true) => inherited("Function", "Function.prototype", name),
                (true, false) => inherited("Object", "Object.prototype", name),
            }
        }
    }
}

fn own_property<'a>(
    properties: &[(PropertyKey<'a>, StaticValue<'a>)],
    key: &PropertyKey<'a>,
) -> Option<StaticValue<'a>> {
    properties
        .iter()
        .find(|property| property.0 == *key)
        .map(|property| property.1.clone())
}

/// `object[key] = value` on a plain object.
pub(super) fn set_property<'a>(
    properties: &mut Vec<(PropertyKey<'a>, StaticValue<'a>)>,
    key: PropertyKey<'a>,
    value: StaticValue<'a>,
) -> Eval<()> {
    // It sets the prototype, to an object or to `null`.
    if key.as_str() == Some(b"__proto__") {
        return if value.is_object() || value == StaticValue::Null {
            Err(Stop::Abort)
        } else {
            Ok(())
        };
    }
    if let Some(property) = properties.iter_mut().find(|property| property.0 == key) {
        property.1 = value;
        return Ok(());
    }
    // Indices come first, in ascending order, then strings, then symbols, in the order they are added.
    let rank = |key: &PropertyKey| match (key.as_index(), key) {
        (Some(index), _) => (0, index),
        (None, PropertyKey::String(_)) => (1, 0),
        (None, PropertyKey::Symbol(_)) => (2, 0),
    };
    let at = properties.partition_point(|property| rank(&property.0) <= rank(&key));
    properties.insert(at, (key, value));
    Ok(())
}
