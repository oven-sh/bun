use bun_alloc::Arena as Bump;
use bun_collections::VecExt;

use crate as js_ast;
use crate::E;
use crate::Symbol;

#[derive(Copy, Clone, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum KnownGlobal {
    WeakSet,
    WeakMap,
    Date,
    Set,
    Map,
    Headers,
    Response,
    TextEncoder,
    TextDecoder,
    Error,
    TypeError,
    SyntaxError,
    RangeError,
    ReferenceError,
    EvalError,
    URIError,
    AggregateError,
    Array,
    Object,
    Function,
    RegExp,
}

// `pub const map = bun.ComptimeEnumMap(KnownGlobal);`
//
// PERF(port): Zig's `ComptimeEnumMap` lowers to a comptime-generated switch.
// Phase A used `phf::Map<&[u8], _>`, which on every probe computes a 128-bit
// SipHash of the name, two modular reductions, a bounds check, and a final
// slice compare. `minify_global_constructor` calls this for every `new Ident`
// expression in the input, and the overwhelming majority of probes are
// *misses* (any user-defined class). A length-gated match rejects those on a
// single `usize` compare and at most 1-3 fixed-size byte compares — no hash,
// no indirection. 21 keys, ≤3 per length bucket: well within the range where
// open-coded dispatch beats `phf`.
#[inline]
pub fn lookup(name: &[u8]) -> Option<KnownGlobal> {
    match name.len() {
        3 => match name {
            b"Set" => Some(KnownGlobal::Set),
            b"Map" => Some(KnownGlobal::Map),
            _ => None,
        },
        4 => match name {
            b"Date" => Some(KnownGlobal::Date),
            _ => None,
        },
        5 => match name {
            b"Error" => Some(KnownGlobal::Error),
            b"Array" => Some(KnownGlobal::Array),
            _ => None,
        },
        6 => match name {
            b"Object" => Some(KnownGlobal::Object),
            b"RegExp" => Some(KnownGlobal::RegExp),
            _ => None,
        },
        7 => match name {
            b"WeakSet" => Some(KnownGlobal::WeakSet),
            b"WeakMap" => Some(KnownGlobal::WeakMap),
            b"Headers" => Some(KnownGlobal::Headers),
            _ => None,
        },
        8 => match name {
            b"Response" => Some(KnownGlobal::Response),
            b"URIError" => Some(KnownGlobal::URIError),
            b"Function" => Some(KnownGlobal::Function),
            _ => None,
        },
        9 => match name {
            b"TypeError" => Some(KnownGlobal::TypeError),
            b"EvalError" => Some(KnownGlobal::EvalError),
            _ => None,
        },
        10 => match name {
            b"RangeError" => Some(KnownGlobal::RangeError),
            _ => None,
        },
        11 => match name {
            b"TextEncoder" => Some(KnownGlobal::TextEncoder),
            b"TextDecoder" => Some(KnownGlobal::TextDecoder),
            b"SyntaxError" => Some(KnownGlobal::SyntaxError),
            _ => None,
        },
        14 => match name {
            b"ReferenceError" => Some(KnownGlobal::ReferenceError),
            b"AggregateError" => Some(KnownGlobal::AggregateError),
            _ => None,
        },
        _ => None,
    }
}

impl KnownGlobal {
    #[inline(always)]
    fn call_from_new(e: &mut E::New, loc: crate::Loc) -> js_ast::Expr {
        let call = E::Call {
            target: e.target,
            args: bun_alloc::AstAlloc::take(&mut e.args),
            close_paren_loc: e.close_parens_loc,
            can_be_unwrapped_if_unused: e.can_be_unwrapped_if_unused,
            ..Default::default()
        };
        js_ast::Expr::init(call, loc)
    }

    // PORT NOTE: `_bump` is kept for call-site shape parity with the Zig
    // `std.mem.Allocator` arg. Phase-A `Vec` uses the global arena.
    #[inline(never)]
    pub fn minify_global_constructor(
        _bump: &Bump,
        e: &mut E::New,
        symbols: &[Symbol],
        loc: crate::Loc,
        minify_whitespace: bool,
    ) -> Option<js_ast::Expr> {
        let id = if let js_ast::ExprData::EIdentifier(ident) = e.target.data {
            ident.ref_
        } else {
            return None;
        };
        let symbol = &symbols[id.inner_index() as usize];
        if symbol.kind != js_ast::symbol::Kind::Unbound {
            return None;
        }

        // SAFETY: `original_name` is an arena-owned slice valid for the
        // lifetime of the symbol table (set at declaration time, never freed
        // before `P` teardown).
        let original_name = symbol.original_name.slice();
        let Some(constructor) = lookup(original_name) else {
            return None;
        };

        match constructor {
            // Error constructors can be called without 'new' with identical behavior
            KnownGlobal::Error
            | KnownGlobal::TypeError
            | KnownGlobal::SyntaxError
            | KnownGlobal::RangeError
            | KnownGlobal::ReferenceError
            | KnownGlobal::EvalError
            | KnownGlobal::URIError
            | KnownGlobal::AggregateError => {
                // Convert `new Error(...)` to `Error(...)` to save bytes
                Some(Self::call_from_new(e, loc))
            }

            KnownGlobal::Object => {
                let n = e.args.len_u32();

                if n == 0 {
                    // new Object() -> {}
                    return Some(js_ast::Expr::init(E::Object::default(), loc));
                }

                if n == 1 {
                    let arg = e.args.slice()[0];
                    match arg.data {
                        js_ast::ExprData::EObject(_) | js_ast::ExprData::EArray(_) => {
                            // new Object({a: 1}) -> {a: 1}
                            // new Object([1, 2]) -> [1, 2]
                            return Some(arg);
                        }
                        js_ast::ExprData::ENull(_) | js_ast::ExprData::EUndefined(_) => {
                            // new Object(null) -> {}
                            // new Object(undefined) -> {}
                            return Some(js_ast::Expr::init(E::Object::default(), loc));
                        }
                        _ => {}
                    }
                }

                // For other cases, just remove 'new'
                Some(Self::call_from_new(e, loc))
            }

            KnownGlobal::Array => {
                let n = e.args.len_u32();

                match n {
                    0 => {
                        // new Array() -> []
                        Some(js_ast::Expr::init(E::Array::default(), loc))
                    }
                    1 => {
                        // For single argument, only convert to literal if we're SURE it's not a number
                        let arg = e.args.slice()[0];

                        // Check if it's an object or array literal first
                        match arg.data {
                            js_ast::ExprData::EObject(_) | js_ast::ExprData::EArray(_) => {
                                // new Array({}) -> [{}], new Array([1]) -> [[1]]
                                // These are definitely not numbers, safe to convert
                                return Some(js_ast::Expr::init(
                                    E::Array {
                                        items: bun_alloc::AstAlloc::take(&mut e.args),
                                        ..Default::default()
                                    },
                                    loc,
                                ));
                            }
                            _ => {}
                        }

                        // For other types, check via knownPrimitive
                        let primitive = arg.known_primitive();
                        // Only convert if we know for certain it's not a number
                        // unknown could be a number at runtime, so we must preserve Array() call
                        match primitive {
                            js_ast::expr::PrimitiveType::Null
                            | js_ast::expr::PrimitiveType::Undefined
                            | js_ast::expr::PrimitiveType::Boolean
                            | js_ast::expr::PrimitiveType::String
                            | js_ast::expr::PrimitiveType::Bigint => {
                                // These are definitely not numbers, safe to convert
                                Some(js_ast::Expr::init(
                                    E::Array {
                                        items: bun_alloc::AstAlloc::take(&mut e.args),
                                        ..Default::default()
                                    },
                                    loc,
                                ))
                            }
                            js_ast::expr::PrimitiveType::Number => {
                                let val = match arg.data {
                                    js_ast::ExprData::ENumber(num) => num.value,
                                    _ => return Some(Self::call_from_new(e, loc)),
                                };
                                if
                                // only want this with whitespace minification
                                minify_whitespace
                                    && (val == 0.0
                                        || val == 1.0
                                        || val == 2.0
                                        || val == 3.0
                                        || val == 4.0
                                        || val == 5.0
                                        || val == 6.0
                                        || val == 7.0
                                        || val == 8.0
                                        || val == 9.0
                                        || val == 10.0)
                                {
                                    let arg_loc = arg.loc;
                                    let mut list = e.args.move_to_list_managed();
                                    list.clear();
                                    // PERF(port): was bun.handleOom(appendNTimes) — Vec::resize aborts on OOM
                                    list.resize(
                                        val as usize,
                                        js_ast::Expr {
                                            data: js_ast::ExprData::EMissing(E::Missing {}),
                                            loc: arg_loc,
                                        },
                                    );
                                    return Some(js_ast::Expr::init(
                                        E::Array {
                                            items: Vec::move_from_list(list),
                                            ..Default::default()
                                        },
                                        loc,
                                    ));
                                }
                                Some(Self::call_from_new(e, loc))
                            }
                            js_ast::expr::PrimitiveType::Unknown
                            | js_ast::expr::PrimitiveType::Mixed => {
                                // Could be a number, preserve Array() call
                                Some(Self::call_from_new(e, loc))
                            }
                        }
                    }
                    // > 1
                    _ => {
                        // new Array(1, 2, 3) -> [1, 2, 3]
                        // But NOT new Array(3) which creates an array with 3 empty slots
                        Some(js_ast::Expr::init(
                            E::Array {
                                items: bun_alloc::AstAlloc::take(&mut e.args),
                                ..Default::default()
                            },
                            loc,
                        ))
                    }
                }
            }

            KnownGlobal::Function => {
                // Just remove 'new' for Function
                Some(Self::call_from_new(e, loc))
            }
            KnownGlobal::RegExp => {
                // Don't optimize RegExp - the semantics are too complex:
                // - new RegExp(re) creates a copy, but RegExp(re) returns the same instance
                // - This affects object identity and lastIndex behavior
                // - The difference only applies when flags are undefined
                // Keep the original new RegExp() call to preserve correct semantics
                None
            }
            KnownGlobal::WeakSet | KnownGlobal::WeakMap => {
                let n = e.args.len_u32();

                if n == 0 {
                    // "new WeakSet()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }

                if n == 1 {
                    match e.args.slice()[0].data {
                        js_ast::ExprData::ENull(_) | js_ast::ExprData::EUndefined(_) => {
                            // "new WeakSet(null)" is pure
                            // "new WeakSet(void 0)" is pure
                            e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                        }
                        js_ast::ExprData::EArray(array) => {
                            if array.items.len_u32() == 0 {
                                // "new WeakSet([])" is pure
                                e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                            } else {
                                // "new WeakSet([x])" is impure because an exception is thrown if "x" is not an object
                            }
                        }
                        _ => {
                            // "new WeakSet(x)" is impure because the iterator for "x" could have side effects
                        }
                    }
                }
                None
            }
            KnownGlobal::Date => {
                let n = e.args.len_u32();

                if n == 0 {
                    // "new Date()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }

                if n == 1 {
                    match e.args.slice()[0].known_primitive() {
                        js_ast::expr::PrimitiveType::Null
                        | js_ast::expr::PrimitiveType::Undefined
                        | js_ast::expr::PrimitiveType::Boolean
                        | js_ast::expr::PrimitiveType::Number
                        | js_ast::expr::PrimitiveType::String => {
                            // "new Date('')" is pure
                            // "new Date(0)" is pure
                            // "new Date(null)" is pure
                            // "new Date(true)" is pure
                            // "new Date(false)" is pure
                            // "new Date(undefined)" is pure
                            e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                        }
                        _ => {
                            // "new Date(x)" is impure because the argument could be a string with side effects
                        }
                    }
                }
                None
            }

            KnownGlobal::Set => {
                let n = e.args.len_u32();

                if n == 0 {
                    // "new Set()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                    return None;
                }

                if n == 1 {
                    match e.args.slice()[0].data {
                        js_ast::ExprData::EArray(_)
                        | js_ast::ExprData::ENull(_)
                        | js_ast::ExprData::EUndefined(_) => {
                            // "new Set([a, b, c])" is pure
                            // "new Set(null)" is pure
                            // "new Set(void 0)" is pure
                            e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                        }
                        _ => {
                            // "new Set(x)" is impure because the iterator for "x" could have side effects
                        }
                    }
                }
                None
            }

            KnownGlobal::Headers => {
                let n = e.args.len_u32();

                if n == 0 {
                    // "new Headers()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }
                None
            }

            KnownGlobal::Response => {
                let n = e.args.len_u32();

                if n == 0 {
                    // "new Response()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }

                if n == 1 {
                    match e.args.slice()[0].known_primitive() {
                        js_ast::expr::PrimitiveType::Null
                        | js_ast::expr::PrimitiveType::Undefined
                        | js_ast::expr::PrimitiveType::Boolean
                        | js_ast::expr::PrimitiveType::Number
                        | js_ast::expr::PrimitiveType::String => {
                            // "new Response('')" is pure
                            // "new Response(0)" is pure
                            // "new Response(null)" is pure
                            // "new Response(true)" is pure
                            // "new Response(false)" is pure
                            // "new Response(undefined)" is pure

                            e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                        }
                        _ => {
                            // "new Response(x)" is impure
                        }
                    }
                }
                None
            }
            KnownGlobal::TextDecoder | KnownGlobal::TextEncoder => {
                let n = e.args.len_u32();

                if n == 0 {
                    // "new TextEncoder()" is pure
                    // "new TextDecoder()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }

                // We _could_ validate the encoding argument
                // But let's not bother
                None
            }

            KnownGlobal::Map => {
                let n = e.args.len_u32();

                if n == 0 {
                    // "new Map()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                    return None;
                }

                if n == 1 {
                    match e.args.slice()[0].data {
                        js_ast::ExprData::ENull(_) | js_ast::ExprData::EUndefined(_) => {
                            // "new Map(null)" is pure
                            // "new Map(void 0)" is pure
                            e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                        }
                        js_ast::ExprData::EArray(array) => {
                            let mut all_items_are_arrays = true;
                            for item in array.items.slice() {
                                if !matches!(item.data, js_ast::ExprData::EArray(_)) {
                                    all_items_are_arrays = false;
                                    break;
                                }
                            }

                            if all_items_are_arrays {
                                // "new Map([[a, b], [c, d]])" is pure
                                e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                            }
                        }
                        _ => {
                            // "new Map(x)" is impure because the iterator for "x" could have side effects
                        }
                    }
                }
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_exhaustive() {
        // Round-trip every variant through its tag name.
        for v in [
            KnownGlobal::WeakSet,
            KnownGlobal::WeakMap,
            KnownGlobal::Date,
            KnownGlobal::Set,
            KnownGlobal::Map,
            KnownGlobal::Headers,
            KnownGlobal::Response,
            KnownGlobal::TextEncoder,
            KnownGlobal::TextDecoder,
            KnownGlobal::Error,
            KnownGlobal::TypeError,
            KnownGlobal::SyntaxError,
            KnownGlobal::RangeError,
            KnownGlobal::ReferenceError,
            KnownGlobal::EvalError,
            KnownGlobal::URIError,
            KnownGlobal::AggregateError,
            KnownGlobal::Array,
            KnownGlobal::Object,
            KnownGlobal::Function,
            KnownGlobal::RegExp,
        ] {
            let name: &'static str = v.into();
            assert!(lookup(name.as_bytes()) == Some(v), "{}", name);
        }
        // Misses at every interesting length, including a length with no bucket.
        for miss in [
            b"".as_slice(),
            b"Se",
            b"Sat",
            b"Math",
            b"Arrow",
            b"String",
            b"Promise",
            b"Function_",
            b"TypeErrorr",
            b"SyntaxErrro",
            b"SyntaxErrorX",
            b"ReferenceErrro",
            b"AggregateErrorX",
        ] {
            assert!(lookup(miss).is_none(), "{:?}", bstr::BStr::new(miss));
        }
    }
}

// ported from: src/js_parser/ast/KnownGlobal.zig
