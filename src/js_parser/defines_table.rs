//! If something is in this list, then a direct identifier expression or property
//! access chain matching this will be assumed to have no side effects and will
//! be removed.
//!
//! This also means code is allowed to be reordered past things in this list. For
//! example, if "console.log" is in this list, permitting reordering allows for
//! "if (a) console.log(b); else console.log(c)" to be reordered and transformed
//! into "console.log(a ? b : c)". Notice that "a" and "console.log" are in a
//! different order, which can only happen if evaluating the "console.log"
//! property access can be assumed to not change the value of "a".
//!
//! Note that membership in this list says nothing about whether calling any of
//! these functions has any side effects. It only says something about
//! referencing these function without calling them.

use crate as js_ast;
use crate::defines;
use bun_ast::ExprData;
use std::sync::OnceLock;

// Zig: `string = []const u8`; each entry is a property-access chain (`&[_]string{...}`).
pub static GLOBAL_NO_SIDE_EFFECT_PROPERTY_ACCESSES: &[&[&[u8]]] = &[
    // Array: Static methods
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array#Static_methods
    &[b"Array", b"from"],
    &[b"Array", b"isArray"],
    &[b"Array", b"of"],
    // JSON: Static methods
    &[b"JSON", b"parse"],
    &[b"JSON", b"stringify"],
    // Math: Static properties
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math#Static_properties
    &[b"Math", b"E"],
    &[b"Math", b"LN10"],
    &[b"Math", b"LN2"],
    &[b"Math", b"LOG10E"],
    &[b"Math", b"LOG2E"],
    &[b"Math", b"PI"],
    &[b"Math", b"SQRT1_2"],
    &[b"Math", b"SQRT2"],
    // Math: Static methods
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math#Static_methods
    &[b"Math", b"abs"],
    &[b"Math", b"acos"],
    &[b"Math", b"acosh"],
    &[b"Math", b"asin"],
    &[b"Math", b"asinh"],
    &[b"Math", b"atan"],
    &[b"Math", b"atan2"],
    &[b"Math", b"atanh"],
    &[b"Math", b"cbrt"],
    &[b"Math", b"ceil"],
    &[b"Math", b"clz32"],
    &[b"Math", b"cos"],
    &[b"Math", b"cosh"],
    &[b"Math", b"exp"],
    &[b"Math", b"expm1"],
    &[b"Math", b"floor"],
    &[b"Math", b"fround"],
    &[b"Math", b"hypot"],
    &[b"Math", b"imul"],
    &[b"Math", b"log"],
    &[b"Math", b"log10"],
    &[b"Math", b"log1p"],
    &[b"Math", b"log2"],
    &[b"Math", b"max"],
    &[b"Math", b"min"],
    &[b"Math", b"pow"],
    &[b"Math", b"random"],
    &[b"Math", b"round"],
    &[b"Math", b"sign"],
    &[b"Math", b"sin"],
    &[b"Math", b"sinh"],
    &[b"Math", b"sqrt"],
    &[b"Math", b"tan"],
    &[b"Math", b"tanh"],
    &[b"Math", b"trunc"],
    // Number: Static methods
    &[b"Number", b"isFinite"],
    &[b"Number", b"isInteger"],
    &[b"Number", b"isNaN"],
    &[b"Number", b"isSafeInteger"],
    &[b"Number", b"parseFloat"],
    &[b"Number", b"parseInt"],
    // Object: Static methods
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object#Static_methods
    &[b"Object", b"assign"],
    &[b"Object", b"create"],
    &[b"Object", b"defineProperties"],
    &[b"Object", b"defineProperty"],
    &[b"Object", b"entries"],
    &[b"Object", b"freeze"],
    &[b"Object", b"fromEntries"],
    &[b"Object", b"getOwnPropertyDescriptor"],
    &[b"Object", b"getOwnPropertyDescriptors"],
    &[b"Object", b"getOwnPropertyNames"],
    &[b"Object", b"getOwnPropertySymbols"],
    &[b"Object", b"getPrototypeOf"],
    &[b"Object", b"groupBy"],
    &[b"Object", b"hasOwn"],
    &[b"Object", b"is"],
    &[b"Object", b"isExtensible"],
    &[b"Object", b"isFrozen"],
    &[b"Object", b"isSealed"],
    &[b"Object", b"keys"],
    &[b"Object", b"preventExtensions"],
    &[b"Object", b"seal"],
    &[b"Object", b"setPrototypeOf"],
    &[b"Object", b"values"],
    // Object: Instance methods
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object#Instance_methods
    &[b"Object", b"prototype", b"__defineGetter__"],
    &[b"Object", b"prototype", b"__defineSetter__"],
    &[b"Object", b"prototype", b"__lookupGetter__"],
    &[b"Object", b"prototype", b"__lookupSetter__"],
    &[b"Object", b"prototype", b"hasOwnProperty"],
    &[b"Object", b"prototype", b"isPrototypeOf"],
    &[b"Object", b"prototype", b"propertyIsEnumerable"],
    &[b"Object", b"prototype", b"toLocaleString"],
    &[b"Object", b"prototype", b"toString"],
    &[b"Object", b"prototype", b"unwatch"],
    &[b"Object", b"prototype", b"valueOf"],
    &[b"Object", b"prototype", b"watch"],
    // Reflect: Static methods
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect#static_methods
    &[b"Reflect", b"apply"],
    &[b"Reflect", b"construct"],
    &[b"Reflect", b"defineProperty"],
    &[b"Reflect", b"deleteProperty"],
    &[b"Reflect", b"get"],
    &[b"Reflect", b"getOwnPropertyDescriptor"],
    &[b"Reflect", b"getPrototypeOf"],
    &[b"Reflect", b"has"],
    &[b"Reflect", b"isExtensible"],
    &[b"Reflect", b"ownKeys"],
    &[b"Reflect", b"preventExtensions"],
    &[b"Reflect", b"set"],
    &[b"Reflect", b"setPrototypeOf"],
    // Symbol: Static properties
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol#static_properties
    &[b"Symbol", b"asyncDispose"],
    &[b"Symbol", b"asyncIterator"],
    &[b"Symbol", b"dispose"],
    &[b"Symbol", b"hasInstance"],
    &[b"Symbol", b"isConcatSpreadable"],
    &[b"Symbol", b"iterator"],
    &[b"Symbol", b"match"],
    &[b"Symbol", b"matchAll"],
    &[b"Symbol", b"replace"],
    &[b"Symbol", b"search"],
    &[b"Symbol", b"species"],
    &[b"Symbol", b"split"],
    &[b"Symbol", b"toPrimitive"],
    &[b"Symbol", b"toStringTag"],
    &[b"Symbol", b"unscopables"],
    // Symbol: Static methods
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol#static_methods
    &[b"Symbol", b"keyFor"],
    // Console method references are assumed to have no side effects
    // https://developer.mozilla.org/en-US/docs/Web/API/console
    &[b"console", b"assert"],
    &[b"console", b"clear"],
    &[b"console", b"count"],
    &[b"console", b"countReset"],
    &[b"console", b"debug"],
    &[b"console", b"dir"],
    &[b"console", b"dirxml"],
    &[b"console", b"error"],
    &[b"console", b"group"],
    &[b"console", b"groupCollapsed"],
    &[b"console", b"groupEnd"],
    &[b"console", b"info"],
    &[b"console", b"log"],
    &[b"console", b"table"],
    &[b"console", b"time"],
    &[b"console", b"timeEnd"],
    &[b"console", b"timeLog"],
    &[b"console", b"trace"],
    &[b"console", b"warn"],
    &[b"Promise", b"resolve"],
    &[b"Promise", b"reject"],
    &[b"Promise", b"all"],
    // Crypto: Static methods
    &[b"crypto", b"randomUUID"],
];

pub static GLOBAL_NO_SIDE_EFFECT_FUNCTION_CALLS_SAFE_FOR_TO_STRING: &[&[&[u8]]] = &[
    // Calling Symbol.for("foo") never throws (unless it's a rope string)
    // This improves React bundle sizes slightly.
    &[b"Symbol", b"for"],
    // Haven't seen a bundle size improvement from adding more to this list yet.
];

// PORTING.md §Concurrency: `OnceLock` for lazily-initialised statics (Zig used
// const struct literals; `DefineData` is not const-constructible in Rust).
//
// `DefineData` is not `Send`/`Sync` in general (it carries `ExprData`, whose
// boxed variants hold `NonNull<_>`). The four instances stored here only ever
// use the inline `EUndefined` / `ENumber` variants and `original_name = None`,
// so they contain no raw pointers and are trivially shareable. Wrap in a local
// newtype to satisfy `OnceLock<T: Sync + Send>` without globally relaxing
// `DefineData`'s auto-traits.
#[repr(transparent)]
struct SyncDefineData(defines::IdentifierDefine);
// SAFETY: only constructed below with pointer-free `ExprData` payloads
// (`EUndefined`/`ENumber`) and `original_name = None`; never mutated after
// `OnceLock` init. See note above.
unsafe impl Sync for SyncDefineData {}
// SAFETY: see `Sync` impl above.
unsafe impl Send for SyncDefineData {}

fn pure_global_identifier_define() -> &'static defines::IdentifierDefine {
    static CELL: OnceLock<SyncDefineData> = OnceLock::new();
    &CELL
        .get_or_init(|| {
            SyncDefineData(defines::DefineData::init(defines::Options {
                value: ExprData::EUndefined(js_ast::E::Undefined),
                valueless: true,
                can_be_removed_if_unused: true,
                ..Default::default()
            }))
        })
        .0
}

mod identifiers {
    use super::{ExprData, OnceLock, SyncDefineData, defines, js_ast};

    const NAN_VAL: js_ast::E::Number = js_ast::E::Number { value: f64::NAN };
    const INF_VAL: js_ast::E::Number = js_ast::E::Number {
        value: f64::INFINITY,
    };

    // Step 2. Swap in certain literal values because those can be constant folded
    pub fn undefined() -> &'static defines::IdentifierDefine {
        static CELL: OnceLock<SyncDefineData> = OnceLock::new();
        &CELL
            .get_or_init(|| {
                SyncDefineData(defines::DefineData::init(defines::Options {
                    value: ExprData::EUndefined(js_ast::E::Undefined),
                    can_be_removed_if_unused: true,
                    ..Default::default()
                }))
            })
            .0
    }
    pub fn nan() -> &'static defines::IdentifierDefine {
        static CELL: OnceLock<SyncDefineData> = OnceLock::new();
        &CELL
            .get_or_init(|| {
                SyncDefineData(defines::DefineData::init(defines::Options {
                    value: ExprData::ENumber(NAN_VAL),
                    ..Default::default()
                }))
            })
            .0
    }
    pub fn infinity() -> &'static defines::IdentifierDefine {
        static CELL: OnceLock<SyncDefineData> = OnceLock::new();
        &CELL
            .get_or_init(|| {
                SyncDefineData(defines::DefineData::init(defines::Options {
                    value: ExprData::ENumber(INF_VAL),
                    ..Default::default()
                }))
            })
            .0
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PureGlobalIdentifierValue {
    NaN,
    Infinity,
    /// Zig: `@"strict undefined"`
    StrictUndefined,
    Other,
}

impl PureGlobalIdentifierValue {
    pub fn value(self) -> &'static defines::IdentifierDefine {
        match self {
            PureGlobalIdentifierValue::NaN => identifiers::nan(),
            PureGlobalIdentifierValue::Infinity => identifiers::infinity(),
            PureGlobalIdentifierValue::StrictUndefined => identifiers::undefined(),
            PureGlobalIdentifierValue::Other => pure_global_identifier_define(),
        }
    }
}

include!("defines_table.generated.rs");

// ported from: src/bundler/defines-table.zig
