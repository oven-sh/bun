use bun_collections::VecExt;
use bun_collections::StringHashMap;
use bun_js_parser as js_ast;
use bun_js_parser::lexer as js_lexer;
use bun_js_parser::ExprData;
use bun_js_parser::Ref;
use bun_logger as logger;
use bun_logger::fs;
use bun_string::strings;

use crate::defines_table::{
    GLOBAL_NO_SIDE_EFFECT_FUNCTION_CALLS_SAFE_FOR_TO_STRING as global_no_side_effect_function_calls_safe_for_to_string,
    GLOBAL_NO_SIDE_EFFECT_PROPERTY_ACCESSES as global_no_side_effect_property_accesses,
};

// ══════════════════════════════════════════════════════════════════════════
// B-3 UNIFIED: `Define` / `DefineData` / `DotDefine` / `Flags` / `Options` /
// `RawDefines` / `UserDefines` / `UserDefinesArray` are canonical in
// `bun_js_parser::defines` (lower tier) so the parser's `P.define: &'a Define`
// and `BundleOptions.define: Box<Define>` are the *same* nominal type. This
// crate adds the json-parse / dotenv-vtable bodies that need
// `bun_interchange` / `bun_dotenv` (tiered above js_parser) via the
// `DefineExt` / `DefineDataExt` extension traits below. The pure-global table
// moved down to `bun_js_parser::defines_table`, so `for_identifier` reads it
// directly with no cross-crate hook.
// ══════════════════════════════════════════════════════════════════════════
pub use bun_js_parser::defines::{
    are_parts_equal, Define, DefineData, DotDefine, Flags, IdentifierDefine, Options, RawDefines,
    UserDefines, UserDefinesArray,
};

/// Alias for `Options` so `options.rs` can write `DefineData::init(DefineDataInit { .. })`
/// (mirrors Zig's anonymous-struct init).
pub type DefineDataInit<'a> = Options<'a>;
/// Alias for `ExprData` so `options.rs` can write `DefineValue::EUndefined(..)`.
pub use bun_js_parser::ExprData as DefineValue;

// `Expr::Data` stores `Number`/`Undefined` inline (not via pointer), so the
// `_PTR` indirection from Zig disappears.
pub struct Globals;
impl Globals {
    pub const UNDEFINED: js_ast::E::Undefined = js_ast::E::Undefined;
    pub const NAN: js_ast::E::Number = js_ast::E::Number { value: f64::NAN };
    pub const INFINITY: js_ast::E::Number = js_ast::E::Number { value: f64::INFINITY };

    #[inline]
    pub fn undefined_data() -> ExprData {
        ExprData::EUndefined(js_ast::E::Undefined)
    }
    #[inline]
    pub fn nan_data() -> ExprData {
        ExprData::ENumber(Globals::NAN)
    }
    #[inline]
    pub fn infinity_data() -> ExprData {
        ExprData::ENumber(Globals::INFINITY)
    }
}

// `fs::Path::init` is not `const fn`; lazily build the path.
fn defines_path() -> fs::Path {
    let mut p = fs::Path::init(b"defines.json");
    p.namespace = b"internal";
    p
}

// Zig: `pub const Data = DefineData;` inside `Define`
// TODO(port): inherent associated type aliases are unstable; expose as module-level alias.
pub type Data = DefineData;

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK(b0): vtable instances for `bun_dotenv::DefineStoreVTable`
// (cold-path §Dispatch). dotenv (T2) calls through `DefineStoreRef`; bundler
// (T5) owns the concrete `E::String` + `DefineData` construction. Mirrors
// src/dotenv/env_loader.zig:399 `copyForDefine` — `to_string` is a
// `StringHashMap<DefineData>` (= UserDefines), `to_json` is a
// `StringHashMap<Box<[u8]>>` (= RawDefines / framework defaults).
// ══════════════════════════════════════════════════════════════════════════

/// Backs `to_string: *StringStore` in `Loader.copyForDefine`.
/// Owner type: `*mut UserDefinesArray` (`StringArrayHashMap<DefineData>`).
pub static ENV_DEFINE_STRING_STORE_VTABLE: bun_dotenv::DefineStoreVTable = bun_dotenv::DefineStoreVTable {
    contains: env_string_store_contains,
    put_string_define: env_string_store_put_string,
    put_raw: env_string_store_put_raw,
};

unsafe fn env_string_store_contains(owner: *mut (), key: &[u8]) -> bool {
    // SAFETY: vtable contract — owner is `*mut UserDefinesArray`.
    unsafe { &*owner.cast::<UserDefinesArray>() }.contains_key(key)
}
unsafe fn env_string_store_put_string(
    owner: *mut (),
    key: &[u8],
    value: &[u8],
) -> Result<(), bun_core::Error> {
    // SAFETY: vtable contract — owner is `*mut UserDefinesArray`.
    let store = unsafe { &mut *owner.cast::<UserDefinesArray>() };
    // Zig (env_loader.zig:461) allocates the `E.String` slab via the passed
    // `allocator` (= `bun.default_allocator`), NOT the thread-local
    // `Expr.Data.Store` — `configureDefines` resets that store on return, so
    // the env-define payloads must outlive it. Mirror with `StoreRef::from_box`
    // (process-lifetime). Value bytes alias the long-lived env-map storage.
    let value: ExprData = ExprData::EString(js_ast::ast::StoreRef::from_box(Box::new(
        js_ast::E::EString::init(value),
    )));
    let data = DefineData::init(Options {
        value,
        can_be_removed_if_unused: true,
        call_can_be_unwrapped_if_unused: js_ast::E::CallUnwrap::IfUnused,
        ..Default::default()
    });
    store.get_or_put_value(key, data)?;
    Ok(())
}
unsafe fn env_string_store_put_raw(
    owner: *mut (),
    key: &[u8],
    value: &[u8],
) -> Result<(), bun_core::Error> {
    // String-store fallback: treat raw as a string literal too (Zig never
    // routes `put_raw` to the StringStore — keep it total for safety).
    unsafe { env_string_store_put_string(owner, key, value) }
}

/// Backs `to_json: *JSONStore` in `Loader.copyForDefine`.
/// Owner type: `*mut RawDefines` (`StringArrayHashMap<Box<[u8]>>`).
pub static ENV_DEFINE_JSON_STORE_VTABLE: bun_dotenv::DefineStoreVTable = bun_dotenv::DefineStoreVTable {
    contains: env_json_store_contains,
    put_string_define: env_json_store_put_raw,
    put_raw: env_json_store_put_raw,
};

unsafe fn env_json_store_contains(owner: *mut (), key: &[u8]) -> bool {
    unsafe { &*owner.cast::<RawDefines>() }.contains_key(key)
}
unsafe fn env_json_store_put_raw(
    owner: *mut (),
    key: &[u8],
    value: &[u8],
) -> Result<(), bun_core::Error> {
    let store = unsafe { &mut *owner.cast::<RawDefines>() };
    store.get_or_put_value(key, Box::<[u8]>::from(value))?;
    Ok(())
}

#[inline]
pub fn env_define_string_store_ref(store: &mut UserDefinesArray) -> bun_dotenv::DefineStoreRef<'_> {
    bun_dotenv::DefineStoreRef::new(
        std::ptr::from_mut::<UserDefinesArray>(store).cast::<()>(),
        &ENV_DEFINE_STRING_STORE_VTABLE,
    )
}

#[inline]
pub fn env_define_json_store_ref(store: &mut RawDefines) -> bun_dotenv::DefineStoreRef<'_> {
    bun_dotenv::DefineStoreRef::new(
        std::ptr::from_mut::<RawDefines>(store).cast::<()>(),
        &ENV_DEFINE_JSON_STORE_VTABLE,
    )
}

// ══════════════════════════════════════════════════════════════════════════
// Extension impls — bodies that need `bun_interchange`.
// ══════════════════════════════════════════════════════════════════════════

/// Extension surface for the canonical `Define` (which lives in `bun_js_parser`).
/// Separate trait so the table-dependent `init` / `insert_global` stay in this
/// crate without an orphan-rule violation.
pub trait DefineExt: Sized {
    fn insert_global(
        &mut self,
        global: &[&[u8]],
        value_define: &DefineData,
    ) -> Result<(), bun_alloc::AllocError>;

    fn init(
        user_defines: Option<UserDefines>,
        string_defines: Option<UserDefinesArray>,
        drop_debugger: bool,
        omit_unused_global_calls: bool,
    ) -> Result<Box<Define>, bun_alloc::AllocError>;
}

impl DefineExt for Define {
    fn insert_global(
        &mut self,
        global: &[&[u8]],
        value_define: &DefineData,
    ) -> Result<(), bun_alloc::AllocError> {
        let key = global[global.len() - 1];
        let parts: Vec<Box<[u8]>> = global.iter().map(|p| Box::<[u8]>::from(*p)).collect();
        // PORT NOTE: reshaped for borrowck — getOrPut split into entry-style match.
        if let Some(existing) = self.dots.get_mut(key) {
            let mut list: Vec<DotDefine> = Vec::with_capacity(existing.len() + 1);
            // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
            list.extend_from_slice(existing);
            // PERF(port): was appendAssumeCapacity — profile in Phase B
            list.push(DotDefine { parts, data: value_define.clone() });
            // Zig: define.arena.free(gpe.value_ptr.*); — handled by Vec drop on assign
            *existing = list;
        } else {
            let mut list: Vec<DotDefine> = Vec::with_capacity(1);
            // PERF(port): was appendAssumeCapacity — profile in Phase B
            list.push(DotDefine { parts, data: value_define.clone() });
            self.dots.insert(key.into(), list);
        }
        Ok(())
    }

    fn init(
        _user_defines: Option<UserDefines>,
        string_defines: Option<UserDefinesArray>,
        drop_debugger: bool,
        omit_unused_global_calls: bool,
    ) -> Result<Box<Define>, bun_alloc::AllocError> {
        let mut define = Box::new(Define {
            identifiers: StringHashMap::default(),
            dots: StringHashMap::default(),
            drop_debugger,
        });
        define.dots.reserve(124);

        let value_define = DefineData::init(Options {
            value: ExprData::EUndefined(js_ast::E::Undefined),
            valueless: true,
            can_be_removed_if_unused: true,
            ..Default::default()
        });
        // Step 1. Load the globals into the hash tables
        for global in global_no_side_effect_property_accesses.iter() {
            define.insert_global(global, &value_define)?;
        }

        let to_string_safe = DefineData::init(Options {
            value: ExprData::EUndefined(js_ast::E::Undefined),
            valueless: true,
            can_be_removed_if_unused: true,
            call_can_be_unwrapped_if_unused: js_ast::E::CallUnwrap::IfUnusedAndToStringSafe,
            ..Default::default()
        });

        if omit_unused_global_calls {
            for global in global_no_side_effect_function_calls_safe_for_to_string.iter() {
                define.insert_global(global, &to_string_safe)?;
            }
        } else {
            for global in global_no_side_effect_function_calls_safe_for_to_string.iter() {
                define.insert_global(global, &value_define)?;
            }
        }

        // Step 3. Load user data into hash tables
        // At this stage, user data has already been validated.
        if let Some(user_defines) = &_user_defines {
            define.insert_from_iterator(
                user_defines
                    .iter()
                    .map(|(k, v): (&Box<[u8]>, &DefineData)| (k.as_ref(), v)),
            )?;
        }

        // Step 4. Load environment data into hash tables.
        // These are only strings. We do not parse them as JSON.
        if let Some(string_defines_) = &string_defines {
            define.insert_from_iterator(
                string_defines_
                    .keys()
                    .iter()
                    .zip(string_defines_.values().iter())
                    .map(|(k, v)| (k.as_ref(), v)),
            )?;
        }

        Ok(define)
    }
}

/// Extension surface for the canonical `DefineData` — `parse` / `from_input`
/// need `bun_interchange::json_parser` / `js_lexer::Keywords`.
pub trait DefineDataExt: Sized {
    fn parse(
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut logger::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<DefineData, bun_core::Error>;

    fn from_mergeable_input_entry(
        user_defines: &mut UserDefines,
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut logger::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<(), bun_core::Error>;

    fn from_input(
        defines: &RawDefines,
        drop: &[&[u8]],
        log: &mut logger::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<UserDefines, bun_core::Error>;
}

impl DefineDataExt for DefineData {
    fn from_mergeable_input_entry(
        user_defines: &mut UserDefines,
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut logger::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<(), bun_core::Error> {
        // PERF(port): was putAssumeCapacity — profile in Phase B
        user_defines.insert(
            key.into(),
            <Self as DefineDataExt>::parse(
                key,
                value_str,
                value_is_undefined,
                method_call_must_be_replaced_with_undefined_,
                log,
                bump,
            )?,
        );
        Ok(())
    }

    fn parse(
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut logger::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<DefineData, bun_core::Error> {
        // TODO(port): narrow error set
        let mut key_splitter = key.split(|b| *b == b'.');
        while let Some(part) = key_splitter.next() {
            if !js_lexer::is_identifier(part) {
                if strings::eql(part, key) {
                    log.add_error_fmt(
                        None,
                        logger::Loc::default(),
                        format_args!(
                            "define key \"{}\" must be a valid identifier",
                            bstr::BStr::new(key)
                        ),
                    )?;
                } else {
                    log.add_error_fmt(
                        None,
                        logger::Loc::default(),
                        format_args!(
                            "define key \"{}\" contains invalid identifier \"{}\"",
                            bstr::BStr::new(part),
                            bstr::BStr::new(value_str)
                        ),
                    )?;
                }
                break;
            }
        }

        // check for nested identifiers
        let mut value_splitter = value_str.split(|b| *b == b'.');
        let mut is_ident = true;

        while let Some(part) = value_splitter.next() {
            if !js_lexer::is_identifier(part) || js_lexer::keyword(part).is_some() {
                is_ident = false;
                break;
            }
        }

        if is_ident {
            // Special-case undefined. it's not an identifier here
            // https://github.com/evanw/esbuild/issues/1407
            let value = if value_is_undefined || value_str == b"undefined" {
                ExprData::EUndefined(js_ast::E::Undefined)
            } else {
                ExprData::EIdentifier(
                    js_ast::E::Identifier::init(Ref::NONE).with_can_be_removed_if_unused(true),
                )
            };

            return Ok(DefineData {
                value,
                // PORT NOTE: upstream `DefineData` now owns `original_name:
                // Option<Box<[u8]>>` (js_parser/lib.rs:1369) instead of the
                // borrowed `ptr`/`len` pair (Zig's 48→40-byte packing). Dupe
                // the value bytes — these are tiny startup-time copies.
                original_name: if !value_str.is_empty() {
                    Some(Box::<[u8]>::from(value_str))
                } else {
                    None
                },
                flags: Flags::new(
                    /* valueless: */ value_is_undefined,
                    /* can_be_removed_if_unused: */ true,
                    /* call_can_be_unwrapped_if_unused: */ js_ast::E::CallUnwrap::Never,
                    /* method_call_must_be_replaced_with_undefined: */
                    method_call_must_be_replaced_with_undefined_,
                ),
            });
        }
        // PORT NOTE: Zig parsed against a stack-local `Source` then
        // `Expr.Data.deepClone`d into the arena to detach from `value_str`.
        // `ExprData::deep_clone` is still gated (b2-ast-round-C), so instead
        // dupe `value_str` into `bump` *before* parsing — every string slice
        // the JSON lexer hands back then already points into the long-lived
        // arena, so the resulting `ExprData` is detached by construction and
        // no post-hoc deep clone is needed. Same arena, same lifetime
        // contract; one extra `value_str.len()` copy vs Zig.
        let arena_value: &[u8] = bump.alloc_slice_copy(value_str);
        let source = logger::Source {
            // `Source.contents` is typed `&'static [u8]` as a Phase-A stand-in
            // (see logger/lib.rs `Str` note). `arena_value` lives in `bump`,
            // which the caller (`Define::init`) owns for the lifetime of the
            // `Define` table — i.e. as long as any `ExprData` produced here is
            // reachable. Route through `StoreStr` for the lifetime erasure.
            contents: std::borrow::Cow::Borrowed(
                bun_js_parser::StoreStr::new(arena_value).slice(),
            ),
            path: defines_path(),
            ..Default::default()
        };
        let expr = bun_interchange::json_parser::parse_env_json(&source, log, bump)?;
        // T2 interchange `Expr` → T4 parser `ExprData` (`From` impl deep-walks
        // and interns into the AST store). All borrowed bytes already live in
        // `bump` (see above), so this is the final value — no `deep_clone`.
        let data: ExprData = expr.data.into();
        let can_be_removed_if_unused = js_ast::ast::expr::Tag::is_primitive_literal(data.tag());
        Ok(DefineData {
            value: data,
            original_name: if !value_str.is_empty() {
                Some(Box::<[u8]>::from(value_str))
            } else {
                None
            },
            flags: Flags::new(
                /* valueless: */ value_is_undefined,
                /* can_be_removed_if_unused: */ can_be_removed_if_unused,
                /* call_can_be_unwrapped_if_unused: */ js_ast::E::CallUnwrap::Never,
                /* method_call_must_be_replaced_with_undefined: */
                method_call_must_be_replaced_with_undefined_,
            ),
        })
    }

    fn from_input(
        defines: &RawDefines,
        drop: &[&[u8]],
        log: &mut logger::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<UserDefines, bun_core::Error> {
        let mut user_defines = UserDefines::default();
        user_defines.reserve((defines.len() + drop.len()) as u32 as usize); // @truncate
        for (key, value) in defines.keys().iter().zip(defines.values().iter()) {
            <Self as DefineDataExt>::from_mergeable_input_entry(
                &mut user_defines, key, value, false, false, log, bump,
            )?;
        }

        for drop_item in drop {
            if !drop_item.is_empty() {
                <Self as DefineDataExt>::from_mergeable_input_entry(
                    &mut user_defines, drop_item, b"", true, true, log, bump,
                )?;
            }
        }

        Ok(user_defines)
    }
}

// var nan_val = try arena.create(js_ast.E.Number);
#[allow(dead_code)]
const NAN_VAL: js_ast::E::Number = js_ast::E::Number { value: f64::NAN };

// Zig `deinit` freed `dots` values, cleared maps, and destroyed `self`.
// In Rust: `dots: StringHashMap<Vec<DotDefine>>` and `identifiers` drop their
// contents automatically; `Box<Define>` frees `self`. No explicit Drop needed.

// ported from: src/bundler/defines.zig
