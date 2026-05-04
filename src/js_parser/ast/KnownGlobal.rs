use bun_alloc::Arena as Bump;
use bun_logger as logger;

use crate::ast as js_ast;
use crate::ast::E;
use crate::ast::Expr;
use crate::ast::Symbol;

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
// phf::Map<&'static [u8], KnownGlobal> built from @tagName(E)
pub static MAP: phf::Map<&'static [u8], KnownGlobal> = phf::phf_map! {
    b"WeakSet" => KnownGlobal::WeakSet,
    b"WeakMap" => KnownGlobal::WeakMap,
    b"Date" => KnownGlobal::Date,
    b"Set" => KnownGlobal::Set,
    b"Map" => KnownGlobal::Map,
    b"Headers" => KnownGlobal::Headers,
    b"Response" => KnownGlobal::Response,
    b"TextEncoder" => KnownGlobal::TextEncoder,
    b"TextDecoder" => KnownGlobal::TextDecoder,
    b"Error" => KnownGlobal::Error,
    b"TypeError" => KnownGlobal::TypeError,
    b"SyntaxError" => KnownGlobal::SyntaxError,
    b"RangeError" => KnownGlobal::RangeError,
    b"ReferenceError" => KnownGlobal::ReferenceError,
    b"EvalError" => KnownGlobal::EvalError,
    b"URIError" => KnownGlobal::URIError,
    b"AggregateError" => KnownGlobal::AggregateError,
    b"Array" => KnownGlobal::Array,
    b"Object" => KnownGlobal::Object,
    b"Function" => KnownGlobal::Function,
    b"RegExp" => KnownGlobal::RegExp,
};

impl KnownGlobal {
    #[inline(always)]
    fn call_from_new(e: &E::New, loc: logger::Loc) -> js_ast::Expr {
        let call = E::Call {
            target: e.target,
            args: e.args,
            close_paren_loc: e.close_parens_loc,
            can_be_unwrapped_if_unused: e.can_be_unwrapped_if_unused,
            ..Default::default()
        };
        js_ast::Expr::init(call, loc)
    }

    #[inline(never)]
    pub fn minify_global_constructor<'bump>(
        bump: &'bump Bump,
        e: &mut E::New,
        symbols: &[Symbol],
        loc: logger::Loc,
        minify_whitespace: bool,
    ) -> Option<js_ast::Expr> {
        let id = if let js_ast::ExprData::EIdentifier(ident) = &e.target.data {
            ident.ref_
        } else {
            return None;
        };
        let symbol = &symbols[id.inner_index() as usize];
        if symbol.kind != js_ast::SymbolKind::Unbound {
            return None;
        }

        let Some(constructor) = MAP.get(symbol.original_name.as_ref()).copied() else {
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
                let n = e.args.len();

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
                let n = e.args.len();

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
                                    E::Array { items: e.args, ..Default::default() },
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
                            js_ast::PrimitiveType::Null
                            | js_ast::PrimitiveType::Undefined
                            | js_ast::PrimitiveType::Boolean
                            | js_ast::PrimitiveType::String
                            | js_ast::PrimitiveType::Bigint => {
                                // These are definitely not numbers, safe to convert
                                Some(js_ast::Expr::init(
                                    E::Array { items: e.args, ..Default::default() },
                                    loc,
                                ))
                            }
                            js_ast::PrimitiveType::Number => {
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
                                    // TODO(port): BabyList<Expr>::move_to_list_managed / move_from_list — verify arena-backed Vec API
                                    let mut list = e.args.move_to_list_managed(bump);
                                    list.clear();
                                    // PERF(port): was bun.handleOom(appendNTimes) — Vec::resize aborts on OOM
                                    list.resize(
                                        val as usize,
                                        js_ast::Expr {
                                            data: crate::Prefill::Data::E_MISSING,
                                            loc: arg_loc,
                                        },
                                    );
                                    return Some(js_ast::Expr::init(
                                        E::Array {
                                            items: bun_collections::BabyList::move_from_list(&mut list),
                                            ..Default::default()
                                        },
                                        loc,
                                    ));
                                }
                                Some(Self::call_from_new(e, loc))
                            }
                            js_ast::PrimitiveType::Unknown | js_ast::PrimitiveType::Mixed => {
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
                            E::Array { items: e.args, ..Default::default() },
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
                let n = e.args.len();

                if n == 0 {
                    // "new WeakSet()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }

                if n == 1 {
                    match &e.args.slice()[0].data {
                        js_ast::ExprData::ENull(_) | js_ast::ExprData::EUndefined(_) => {
                            // "new WeakSet(null)" is pure
                            // "new WeakSet(void 0)" is pure
                            e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                        }
                        js_ast::ExprData::EArray(array) => {
                            if array.items.len() == 0 {
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
                let n = e.args.len();

                if n == 0 {
                    // "new Date()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }

                if n == 1 {
                    match e.args.slice()[0].known_primitive() {
                        js_ast::PrimitiveType::Null
                        | js_ast::PrimitiveType::Undefined
                        | js_ast::PrimitiveType::Boolean
                        | js_ast::PrimitiveType::Number
                        | js_ast::PrimitiveType::String => {
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
                let n = e.args.len();

                if n == 0 {
                    // "new Set()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                    return None;
                }

                if n == 1 {
                    match &e.args.slice()[0].data {
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
                let n = e.args.len();

                if n == 0 {
                    // "new Headers()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }
                None
            }

            KnownGlobal::Response => {
                let n = e.args.len();

                if n == 0 {
                    // "new Response()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;

                    return None;
                }

                if n == 1 {
                    match e.args.slice()[0].known_primitive() {
                        js_ast::PrimitiveType::Null
                        | js_ast::PrimitiveType::Undefined
                        | js_ast::PrimitiveType::Boolean
                        | js_ast::PrimitiveType::Number
                        | js_ast::PrimitiveType::String => {
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
                let n = e.args.len();

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
                let n = e.args.len();

                if n == 0 {
                    // "new Map()" is pure
                    e.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                    return None;
                }

                if n == 1 {
                    match &e.args.slice()[0].data {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/KnownGlobal.zig (361 lines)
//   confidence: medium
//   todos:      1
//   notes:      ExprData variant names, E::Call/Array/Object struct-init shapes, BabyList<Expr> move_to_list/move_from_list, and Expr::init signature need Phase-B fixup.
// ──────────────────────────────────────────────────────────────────────────
