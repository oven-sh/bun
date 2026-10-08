//! Which global variables exist.

use crate::ast::File;
use crate::language::{Global, SourceType};

/// The year of the edition of ECMAScript that added the global variable `name`: ESLint's
/// `conf/globals.js`.
fn ecma_version_of(name: &[u8]) -> Option<u32> {
    Some(match name {
        b"Array" | b"Boolean" | b"constructor" | b"Date" | b"decodeURI" | b"decodeURIComponent" | b"encodeURI"
        | b"encodeURIComponent" | b"Error" | b"escape" | b"eval" | b"EvalError" | b"Function" | b"hasOwnProperty"
        | b"Infinity" | b"isFinite" | b"isNaN" | b"isPrototypeOf" | b"Math" | b"NaN" | b"Number" | b"Object"
        | b"parseFloat" | b"parseInt" | b"propertyIsEnumerable" | b"RangeError" | b"ReferenceError" | b"RegExp"
        | b"String" | b"SyntaxError" | b"toLocaleString" | b"toString" | b"TypeError" | b"undefined" | b"unescape"
        | b"URIError" | b"valueOf" => 3,
        b"JSON" => 5,
        b"ArrayBuffer" | b"DataView" | b"Float32Array" | b"Float64Array" | b"Int16Array" | b"Int32Array" | b"Int8Array"
        | b"Intl" | b"Map" | b"Promise" | b"Proxy" | b"Reflect" | b"Set" | b"Symbol" | b"Uint16Array" | b"Uint32Array"
        | b"Uint8Array" | b"Uint8ClampedArray" | b"WeakMap" | b"WeakSet" => 2015,
        b"Atomics" | b"SharedArrayBuffer" => 2017,
        b"BigInt" | b"BigInt64Array" | b"BigUint64Array" | b"globalThis" => 2020,
        b"AggregateError" | b"FinalizationRegistry" | b"WeakRef" => 2021,
        b"Float16Array" | b"Iterator" => 2025,
        b"AsyncDisposableStack" | b"DisposableStack" | b"SuppressedError" | b"Temporal" => 2026,
        _ => return None,
    })
}

/// Whether ESLint's global scope has a variable `name` that no code declares: it is configured in
/// `languageOptions.globals`, or it comes with `ecmaVersion` or `sourceType`.
pub(super) fn is_defined_global(file: &File<'_>, name: &[u8]) -> bool {
    let language = file.language();
    match language.global(name) {
        Some(global) => global != Global::Off,
        None => {
            ecma_version_of(name).is_some_and(|version| version <= language.ecma_version)
                || (language.source_type == SourceType::CommonJs
                    && matches!(name, b"exports" | b"global" | b"module" | b"require"))
        }
    }
}
