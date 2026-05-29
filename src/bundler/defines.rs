use bun_ast::ExprData;
use bun_ast::Ref;
use bun_collections::StringHashMap;
use bun_core::strings;
use bun_js_parser::lexer as js_lexer;

use crate::defines_table::{
    GLOBAL_NO_SIDE_EFFECT_FUNCTION_CALLS_SAFE_FOR_TO_STRING as global_no_side_effect_function_calls_safe_for_to_string,
    GLOBAL_NO_SIDE_EFFECT_PROPERTY_ACCESSES as global_no_side_effect_property_accesses,
};

pub use bun_js_parser::defines::{
    Define, DefineData, DotDefine, Flags, IdentifierDefine, Options, RawDefines, UserDefines,
    UserDefinesArray, are_parts_equal,
};

/// Alias for `Options` so `options.rs` can write `DefineData::init(DefineDataInit { .. })`
/// (mirrors Zig's anonymous-struct init).
pub type DefineDataInit<'a> = Options<'a>;
/// Alias for `ExprData` so `options.rs` can write `DefineValue::EUndefined(..)`.
pub(crate) use bun_ast::ExprData as DefineValue;

// `Expr::Data` stores `Number`/`Undefined` inline (not via pointer), so the
// `_PTR` indirection from Zig disappears.
pub struct Globals;
impl Globals {
    pub const UNDEFINED: bun_ast::E::Undefined = bun_ast::E::Undefined;
    pub const NAN: bun_ast::E::Number = bun_ast::E::Number { value: f64::NAN };
    pub const INFINITY: bun_ast::E::Number = bun_ast::E::Number {
        value: f64::INFINITY,
    };

    #[inline]
    pub fn undefined_data() -> ExprData {
        ExprData::EUndefined(bun_ast::E::Undefined)
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

use bun_paths::fs::Path as FsPath;
// `Path::init` is not `const fn`; lazily build the path.
fn defines_path() -> FsPath<'static> {
    let mut p = FsPath::init(b"defines.json");
    p.namespace = b"internal";
    p
}

// Zig: `pub const Data = DefineData;` inside `Define`
// TODO(port): inherent associated type aliases are unstable; expose as module-level alias.
pub type Data = DefineData;

fn env_string_store_put(
    store: &mut UserDefinesArray,
    bump: &bun_alloc::Arena,
    key: &[u8],
    value: &[u8],
) -> Result<(), bun_core::Error> {
    let value: ExprData = ExprData::EString(bun_ast::StoreRef::from_bump(
        bump.alloc(bun_ast::E::EString::init(value)),
    ));
    let data = DefineData::init(Options {
        value,
        can_be_removed_if_unused: true,
        call_can_be_unwrapped_if_unused: bun_ast::E::CallUnwrap::IfUnused,
        ..Default::default()
    });
    store.get_or_put_value(key, data)?;
    Ok(())
}

pub fn copy_env_for_define(
    env: &bun_dotenv::Loader<'_>,
    to_json: &mut RawDefines,
    to_string: &mut UserDefinesArray,
    framework_defaults_keys: &[&[u8]],
    framework_defaults_values: &[&[u8]],
    behavior: bun_dotenv::DotEnvBehavior,
    prefix: &[u8],
    bump: &bun_alloc::Arena,
) -> Result<(), bun_core::Error> {
    use bun_dotenv::DotEnvBehavior;
    const INVALID_HASH: u64 = u64::MAX - 1;
    let mut string_map_hashes: Vec<u64> = vec![INVALID_HASH; framework_defaults_keys.len()];

    // Frameworks determine an allowlist of values
    const PROCESS_ENV: &[u8] = b"process.env.";
    for (i, &key) in framework_defaults_keys.iter().enumerate() {
        if key.len() > PROCESS_ENV.len() && &key[..PROCESS_ENV.len()] == PROCESS_ENV {
            let hashable_segment = &key[PROCESS_ENV.len()..];
            string_map_hashes[i] = bun_wyhash::hash(hashable_segment);
        }
    }

    // PORT NOTE: Zig pre-counted `key_buf_len`/`e_strings_to_allocate` to size two bump
    // allocations, then `iter.reset()` and re-walked. With per-entry copies the pre-sizing
    // pass is dead — emit directly. PERF(port): was single-buffer key arena; now per-entry Vec reuse.
    if behavior != DotEnvBehavior::Disable && behavior != DotEnvBehavior::LoadAllWithoutInlining {
        if behavior == DotEnvBehavior::Prefix {
            debug_assert!(!prefix.is_empty());
        }

        let any_prefix_match = if behavior == DotEnvBehavior::Prefix {
            env.map
                .map
                .keys()
                .iter()
                .any(|k| bun_core::starts_with(k, prefix))
        } else {
            true
        };

        if any_prefix_match {
            let mut key_buf: Vec<u8> = Vec::new();
            // PORT NOTE: borrowck — iterate parallel slices instead of `iterator()` so the
            // map borrow stays shared while we write into the define stores.
            let keys = env.map.map.keys();
            let values = env.map.map.values();
            for (k, v) in keys.iter().zip(values.iter()) {
                if k.is_empty() {
                    continue;
                }
                let value: &[u8] = &v.value;

                if behavior == DotEnvBehavior::Prefix {
                    if bun_core::starts_with(k, prefix) {
                        key_buf.clear();
                        key_buf.extend_from_slice(PROCESS_ENV);
                        key_buf.extend_from_slice(k);
                        env_string_store_put(to_string, bump, &key_buf, value)?;
                    } else {
                        let hash = bun_wyhash::hash(k);
                        debug_assert!(hash != INVALID_HASH);
                        if let Some(key_i) = string_map_hashes.iter().position(|&h| h == hash) {
                            env_string_store_put(
                                to_string,
                                bump,
                                framework_defaults_keys[key_i],
                                value,
                            )?;
                        }
                    }
                } else {
                    key_buf.clear();
                    key_buf.extend_from_slice(PROCESS_ENV);
                    key_buf.extend_from_slice(k);
                    env_string_store_put(to_string, bump, &key_buf, value)?;
                }
            }
        }
    }

    for (i, &key) in framework_defaults_keys.iter().enumerate() {
        let value = framework_defaults_values[i];
        if !to_string.contains_key(key) && !to_json.contains_key(key) {
            to_json.get_or_put_value(key, Box::<[u8]>::from(value))?;
        }
    }

    Ok(())
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
            // PERF(port): was appendSliceAssumeCapacity — profile if hot.
            list.extend_from_slice(existing);
            // PERF(port): was appendAssumeCapacity — profile if hot.
            list.push(DotDefine {
                parts,
                data: value_define.clone(),
            });
            // Zig: define.arena.free(gpe.value_ptr.*); — handled by Vec drop on assign
            *existing = list;
        } else {
            let list: Vec<DotDefine> = vec![DotDefine {
                parts,
                data: value_define.clone(),
            }];
            self.dots.put_assume_capacity(key, list);
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
            value: ExprData::EUndefined(bun_ast::E::Undefined),
            valueless: true,
            can_be_removed_if_unused: true,
            ..Default::default()
        });
        // Step 1. Load the globals into the hash tables
        for global in global_no_side_effect_property_accesses.iter() {
            define.insert_global(global, &value_define)?;
        }

        let to_string_safe = DefineData::init(Options {
            value: ExprData::EUndefined(bun_ast::E::Undefined),
            valueless: true,
            can_be_removed_if_unused: true,
            call_can_be_unwrapped_if_unused: bun_ast::E::CallUnwrap::IfUnusedAndToStringSafe,
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
            define.insert_from_iterator(user_defines.iter().map(|(k, v)| (k.as_ref(), v)))?;
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

fn const_default_define_value(value_str: &[u8]) -> Option<ExprData> {
    static DEVELOPMENT: bun_ast::E::EString = bun_ast::E::EString::from_static(b"development");
    static PRODUCTION: bun_ast::E::EString = bun_ast::E::EString::from_static(b"production");
    static TEST: bun_ast::E::EString = bun_ast::E::EString::from_static(b"test");
    if value_str == b"\"development\"" {
        Some(ExprData::EString(bun_ast::StoreRef::from_static(
            &DEVELOPMENT,
        )))
    } else if value_str == b"\"production\"" {
        Some(ExprData::EString(bun_ast::StoreRef::from_static(
            &PRODUCTION,
        )))
    } else if value_str == b"\"test\"" {
        Some(ExprData::EString(bun_ast::StoreRef::from_static(&TEST)))
    } else if value_str == b"true" {
        Some(ExprData::EBoolean(bun_ast::E::Boolean { value: true }))
    } else if value_str == b"false" {
        Some(ExprData::EBoolean(bun_ast::E::Boolean { value: false }))
    } else {
        None
    }
}

/// Extension surface for the canonical `DefineData` — `parse` / `from_input`
/// need `bun_parsers::json_parser` / `js_lexer::Keywords`.
pub trait DefineDataExt: Sized {
    fn parse(
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<DefineData, bun_core::Error>;

    fn from_mergeable_input_entry(
        user_defines: &mut UserDefines,
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<(), bun_core::Error>;

    fn from_input(
        defines: &RawDefines,
        drop: &[&[u8]],
        log: &mut bun_ast::Log,
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
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<(), bun_core::Error> {
        // PERF(port): was putAssumeCapacity — profile if hot.
        user_defines.put_assume_capacity(
            key,
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
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<DefineData, bun_core::Error> {
        // TODO(port): narrow error set
        let mut key_splitter = key.split(|b| *b == b'.');
        while let Some(part) = key_splitter.next() {
            if !js_lexer::is_identifier(part) {
                if strings::eql(part, key) {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::default(),
                        format_args!(
                            "define key \"{}\" must be a valid identifier",
                            bstr::BStr::new(key)
                        ),
                    );
                } else {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::default(),
                        format_args!(
                            "define key \"{}\" contains invalid identifier \"{}\"",
                            bstr::BStr::new(part),
                            bstr::BStr::new(value_str)
                        ),
                    );
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
                ExprData::EUndefined(bun_ast::E::Undefined)
            } else {
                ExprData::EIdentifier(
                    bun_ast::E::Identifier::init(Ref::NONE).with_can_be_removed_if_unused(true),
                )
            };

            return Ok(DefineData {
                value,
                original_name: if !value_str.is_empty() {
                    Some(Box::<[u8]>::from(value_str))
                } else {
                    None
                },
                flags: Flags::new(
                    /* valueless: */ value_is_undefined,
                    /* can_be_removed_if_unused: */ true,
                    /* call_can_be_unwrapped_if_unused: */ bun_ast::E::CallUnwrap::Never,
                    /* method_call_must_be_replaced_with_undefined: */
                    method_call_must_be_replaced_with_undefined_,
                ),
            });
        }

        if let Some(value) = const_default_define_value(value_str) {
            let can_be_removed_if_unused = bun_ast::expr::Tag::is_primitive_literal(value.tag());
            return Ok(DefineData {
                value,
                original_name: if !value_str.is_empty() {
                    Some(Box::<[u8]>::from(value_str))
                } else {
                    None
                },
                flags: Flags::new(
                    /* valueless: */ value_is_undefined,
                    /* can_be_removed_if_unused: */ can_be_removed_if_unused,
                    /* call_can_be_unwrapped_if_unused: */ bun_ast::E::CallUnwrap::Never,
                    /* method_call_must_be_replaced_with_undefined: */
                    method_call_must_be_replaced_with_undefined_,
                ),
            });
        }

        bun_ast::Expr::data_store_create();
        bun_ast::Stmt::data_store_create();
        let arena_value: &[u8] = bump.alloc_slice_copy(value_str);
        let source = bun_ast::Source {
            contents: std::borrow::Cow::Borrowed(bun_ast::StoreStr::new(arena_value).slice()),
            path: defines_path(),
            ..Default::default()
        };
        let expr = bun_parsers::json_parser::parse_env_json(&source, log, bump)?;
        let data: ExprData = expr.data.deep_clone(bump)?;
        let can_be_removed_if_unused = bun_ast::expr::Tag::is_primitive_literal(data.tag());
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
                /* call_can_be_unwrapped_if_unused: */ bun_ast::E::CallUnwrap::Never,
                /* method_call_must_be_replaced_with_undefined: */
                method_call_must_be_replaced_with_undefined_,
            ),
        })
    }

    fn from_input(
        defines: &RawDefines,
        drop: &[&[u8]],
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<UserDefines, bun_core::Error> {
        let mut user_defines = UserDefines::default();
        user_defines.reserve((defines.len() + drop.len()) as u32 as usize); // @truncate
        for (key, value) in defines.keys().iter().zip(defines.values().iter()) {
            <Self as DefineDataExt>::from_mergeable_input_entry(
                &mut user_defines,
                key,
                value,
                false,
                false,
                log,
                bump,
            )?;
        }

        for drop_item in drop {
            if !drop_item.is_empty() {
                <Self as DefineDataExt>::from_mergeable_input_entry(
                    &mut user_defines,
                    drop_item,
                    b"",
                    true,
                    true,
                    log,
                    bump,
                )?;
            }
        }

        Ok(user_defines)
    }
}

// Zig `deinit` freed `dots` values, cleared maps, and destroyed `self`.
// In Rust: `dots: StringHashMap<Vec<DotDefine>>` and `identifiers` drop their
// contents automatically; `Box<Define>` frees `self`. No explicit Drop needed.

// ported from: src/bundler/defines.zig
