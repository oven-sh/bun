use bun_ast::ExprData;
use bun_ast::Ref;
use bun_core::strings;
use bun_js_parser::lexer as js_lexer;

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
    Define, DefineData, DotDefine, Flags, IdentifierDefine, Options, RawDefines, UserDefines,
    UserDefinesArray, are_parts_equal,
};

/// Alias for `Options` so `options.rs` can write `DefineData::init(DefineDataInit { .. })`.
pub(crate) type DefineDataInit<'a> = Options<'a>;
/// Alias for `ExprData` so `options.rs` can write `DefineValue::EUndefined(..)`.
pub(crate) use bun_ast::ExprData as DefineValue;

// `Expr::Data` stores `Number`/`Undefined` inline (not via pointer), so no
// pointer indirection is needed for these constants.

use bun_paths::fs::Path as FsPath;
// `Path::init` is not `const fn`; lazily build the path.
fn defines_path() -> FsPath<'static> {
    let mut p = FsPath::init(b"defines.json");
    p.namespace = b"internal";
    p
}

// ══════════════════════════════════════════════════════════════════════════
// `process.env.*` → define entries
// ══════════════════════════════════════════════════════════════════════════

fn env_string_define(bump: &bun_alloc::Arena, value: &[u8]) -> DefineData {
    // The `E.String` slab must NOT live in the thread-local
    // `Expr.Data.Store` — `configureDefines` resets that store on return, so
    // the env-define payloads must outlive it. Allocate from `bump` (the
    // transpiler arena) so the slab is bulk-freed with the `Define` table
    // instead of leaking a `Box` per env var. Copy the value because
    // `Bun__setEnvValue` frees the env-map entry it points into.
    let value: &[u8] = bump.alloc_slice_copy(value);
    let value: ExprData = ExprData::EString(bun_ast::StoreRef::from_bump(
        bump.alloc(bun_ast::E::EString::init(value)),
    ));
    DefineData::init(Options {
        value,
        can_be_removed_if_unused: true,
        call_can_be_unwrapped_if_unused: bun_ast::E::CallUnwrap::IfUnused,
        ..Default::default()
    })
}

/// Copies the dotenv loader's entries into `to_string` as `process.env.*` and `import.meta.env.*` defines.
pub(crate) fn copy_env_for_define(
    env: &bun_dotenv::Loader,
    to_string: &mut UserDefinesArray,
    behavior: bun_dotenv::DotEnvBehavior,
    prefix: &[u8],
    bump: &bun_alloc::Arena,
) -> Result<(), crate::Error> {
    use bun_dotenv::DotEnvBehavior;
    const IMPORT_META_ENV: &[u8] = b"import.meta.env.";
    const NAMESPACES: [&[u8]; 2] = [b"process.env.", IMPORT_META_ENV];

    if behavior == DotEnvBehavior::Disable || behavior == DotEnvBehavior::LoadAllWithoutInlining {
        return Ok(());
    }
    if behavior == DotEnvBehavior::Prefix {
        debug_assert!(!prefix.is_empty());
    }

    let mut key_buf: Vec<u8> = Vec::new();
    // borrowck — iterate parallel slices instead of `iterator()` so the
    // map borrow stays shared while we write into the define store.
    let keys = env.map.map.keys();
    let values = env.map.map.values();
    for (k, v) in keys.iter().zip(values.iter()) {
        if k.is_empty() {
            continue;
        }
        if behavior == DotEnvBehavior::Prefix && !bun_core::strings::starts_with(k, prefix) {
            continue;
        }
        let data = env_string_define(bump, &v.value);
        for namespace in NAMESPACES {
            // `import.meta.env.DEV` is the mode, never a variable (as in `ImportMetaEnv.cpp`).
            if namespace == IMPORT_META_ENV && ImportMetaEnvMode::is_mode_key(k) {
                continue;
            }
            key_buf.clear();
            key_buf.extend_from_slice(namespace);
            key_buf.extend_from_slice(k);
            to_string.get_or_put_value(&key_buf, data.clone())?;
        }
    }

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════
// `import.meta.env` mode keys
// ══════════════════════════════════════════════════════════════════════════

/// What one bundle folds Vite's `import.meta.env` mode keys to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ImportMetaEnvMode {
    pub production: bool,
    /// The bundle runs on the server. It gets the mode keys and no object.
    pub ssr: bool,
    /// A static production build (`bun build --app`).
    pub static_build: bool,
}

impl ImportMetaEnvMode {
    /// (define key, property name) of each mode key, in the order `values` uses.
    const KEYS: [(&'static [u8], &'static [u8]); 5] = [
        (b"import.meta.env.DEV", b"DEV"),
        (b"import.meta.env.PROD", b"PROD"),
        (b"import.meta.env.MODE", b"MODE"),
        (b"import.meta.env.SSR", b"SSR"),
        (b"import.meta.env.STATIC", b"STATIC"),
    ];

    /// Whether `name` is one of the mode keys (`DEV`, `MODE`, ...).
    pub fn is_mode_key(name: &[u8]) -> bool {
        Self::KEYS.iter().any(|(_, mode_key)| *mode_key == name)
    }

    fn values(self) -> [&'static [u8]; 5] {
        const fn boolean(value: bool) -> &'static [u8] {
            if value { b"true" } else { b"false" }
        }
        [
            boolean(!self.production),
            boolean(self.production),
            if self.production {
                b"\"production\""
            } else {
                b"\"development\""
            },
            boolean(self.ssr),
            boolean(self.static_build),
        ]
    }

    /// The (key, JSON value) define entries. A client bundle also gets the object
    /// itself with the mode keys only, so that an unknown key reads `undefined`.
    pub fn defines(self) -> Vec<(&'static [u8], Vec<u8>)> {
        let values = self.values();
        let mut out: Vec<(&'static [u8], Vec<u8>)> = Vec::with_capacity(Self::KEYS.len() + 1);
        if !self.ssr {
            let mut object: Vec<u8> = Vec::with_capacity(96);
            object.push(b'{');
            for (i, ((_, name), value)) in Self::KEYS.iter().zip(values.iter()).enumerate() {
                if i > 0 {
                    object.push(b',');
                }
                object.push(b'"');
                object.extend_from_slice(name);
                object.extend_from_slice(b"\":");
                object.extend_from_slice(value);
            }
            object.push(b'}');
            out.push((b"import.meta.env", object));
        }
        for ((key, _), value) in Self::KEYS.iter().zip(values.iter()) {
            out.push((key, value.to_vec()));
        }
        out
    }
}

// ══════════════════════════════════════════════════════════════════════════
// Extension impls — bodies that need `bun_interchange`.
// ══════════════════════════════════════════════════════════════════════════

/// Extension surface for the canonical `Define` (which lives in `bun_js_parser`).
pub trait DefineExt: Sized {
    fn init(
        user_defines: Option<UserDefines>,
        string_defines: Option<UserDefinesArray>,
        drop_debugger: bool,
        omit_unused_global_calls: bool,
    ) -> Result<Box<Define>, bun_alloc::AllocError>;
}

impl DefineExt for Define {
    fn init(
        _user_defines: Option<UserDefines>,
        string_defines: Option<UserDefinesArray>,
        drop_debugger: bool,
        omit_unused_global_calls: bool,
    ) -> Result<Box<Define>, bun_alloc::AllocError> {
        // Step 1. Load the globals into the hash tables
        let mut define = Define::with_pure_globals(drop_debugger, omit_unused_global_calls);

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

/// Pre-built `ExprData` for the literal define *values* Bun auto-injects on
/// every transpiler init: `"development"` / `"production"` / `"test"` (the
/// `process.env.NODE_ENV` & `process.env.BUN_ENV` defaults) and `true` /
/// `false` (the `process.browser` default). The `E::EString` payloads live in
/// process-lifetime `static`s — producing one is allocation-free and never
/// touches the thread-local AST store `json_parser::parse_env_json` writes into.
/// Returns `None` for everything else (user `--define` values, env-file
/// `NODE_ENV` overrides like `staging`, JSON object/array literals, …), which
/// falls through to the general `parse_env_json` path in `DefineData::parse`.
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
    ) -> Result<DefineData, crate::Error>;

    fn from_mergeable_input_entry(
        user_defines: &mut UserDefines,
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<(), crate::Error>;

    fn from_input(
        defines: &RawDefines,
        drop: &[&[u8]],
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<UserDefines, crate::Error>;
}

/// The positions are in the text of the define, and the printer takes them for ones in the file.
fn clear_locs(expr: &mut bun_ast::Expr) {
    expr.loc = bun_ast::Loc::EMPTY;
    match expr.data {
        ExprData::EObject(mut object) => {
            object.close_brace_loc = bun_ast::Loc::EMPTY;
            for property in object.properties.iter_mut() {
                if let Some(key) = &mut property.key {
                    clear_locs(key);
                }
                if let Some(value) = &mut property.value {
                    clear_locs(value);
                }
            }
        }
        ExprData::EArray(mut array) => {
            array.close_bracket_loc = bun_ast::Loc::EMPTY;
            array.items.iter_mut().for_each(clear_locs);
        }
        _ => {}
    }
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
    ) -> Result<(), crate::Error> {
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
    ) -> Result<DefineData, crate::Error> {
        let mut key_splitter = strings::split(key, b".");
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
        let mut value_splitter = strings::split(value_str, b".");
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
                // upstream `DefineData` now owns `original_name:
                // Option<Box<[u8]>>` (js_parser/lib.rs:1369) instead of a
                // borrowed `ptr`/`len` pair. Dupe
                // the value bytes — these are tiny startup-time copies.
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

        // Fast path for the compile-time-constant literal define *values* that
        // Bun auto-injects on every transpiler init (`"development"` /
        // `"production"` / `"test"` for `process.env.NODE_ENV` & `BUN_ENV`, and
        // `true` / `false` for `process.browser`) — the entire default define
        // set on the `bun run` path. Build the `DefineData` straight from
        // process-lifetime statics: skips the `bump.alloc_slice_copy` +
        // `json_parser::parse_env_json` + `Expr::deep_clone` round-trip and,
        // crucially, never touches the thread-local AST `Expr`/`Stmt` stores
        // (created lazily below only when a value really needs JSON parsing).
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

        // `parse_env_json` builds `E::String`/`E::Object` nodes in the
        // thread-local AST `Expr`/`Stmt` stores, so create them now — done
        // lazily here (idempotent no-ops once created) instead of eagerly in
        // `Transpiler::configure_defines`, since most inits resolve every define
        // through the fast path above and never need an AST store.
        bun_ast::Expr::data_store_create();
        bun_ast::Stmt::data_store_create();
        let arena_value: &[u8] = bump.alloc_slice_copy(value_str);
        let source = bun_ast::Source {
            contents: std::borrow::Cow::Borrowed(arena_value),
            path: defines_path(),
            ..Default::default()
        };
        let expr = bun_parsers::json_parser::parse_env_json(&source, log, bump)?;
        // The `deep_clone` is load-bearing even though `.data` bytes already
        // live in `bump`: `parse_env_json` → `new_expr` → `Expr::init` allocates
        // the `E::String` *payload* (the `StoreRef` target) in the thread-local
        // AST store, which `configure_defines` resets on return via
        // `StoreResetGuard`. Before the `bun_ast` unification this was masked by
        // `.into()` deep-walking T2→T4 and re-boxing the payload; now `.into()`
        // is identity, so without `deep_clone` the `DefineData.value` dangles
        // into a freed slab and `process.env.NODE_ENV` reads garbage.
        let mut expr = bun_parsers::json_parser::clone_out_of_store(&expr, &source, log, bump)?;
        clear_locs(&mut expr);
        let data: ExprData = expr.data;
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
    ) -> Result<UserDefines, crate::Error> {
        let mut user_defines = UserDefines::default();
        user_defines.reserve((defines.len() + drop.len()) as u32 as usize);
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

// `dots: StringHashMap<Vec<DotDefine>>` and `identifiers` drop their
// contents automatically; `Box<Define>` frees `self`. No explicit Drop needed.

#[cfg(test)]
mod tests {
    use super::ImportMetaEnvMode;

    fn as_strs(defines: &[(&'static [u8], Vec<u8>)]) -> Vec<(&'static str, String)> {
        defines
            .iter()
            .map(|(k, v)| {
                (
                    core::str::from_utf8(k).unwrap(),
                    String::from_utf8(v.clone()).unwrap(),
                )
            })
            .collect()
    }

    #[test]
    fn client_bundle_defines_the_whole_object_and_every_mode_key() {
        let mode = ImportMetaEnvMode {
            production: false,
            ssr: false,
            static_build: false,
        };
        assert_eq!(
            as_strs(&mode.defines()),
            [
                (
                    "import.meta.env",
                    r#"{"DEV":true,"PROD":false,"MODE":"development","SSR":false,"STATIC":false}"#
                        .into()
                ),
                ("import.meta.env.DEV", "true".into()),
                ("import.meta.env.PROD", "false".into()),
                ("import.meta.env.MODE", "\"development\"".into()),
                ("import.meta.env.SSR", "false".into()),
                ("import.meta.env.STATIC", "false".into()),
            ]
        );
    }

    #[test]
    fn server_bundle_keeps_the_live_object() {
        let mode = ImportMetaEnvMode {
            production: true,
            ssr: true,
            static_build: true,
        };
        assert_eq!(
            as_strs(&mode.defines()),
            [
                ("import.meta.env.DEV", "false".into()),
                ("import.meta.env.PROD", "true".into()),
                ("import.meta.env.MODE", "\"production\"".into()),
                ("import.meta.env.SSR", "true".into()),
                ("import.meta.env.STATIC", "true".into()),
            ]
        );
    }
}
