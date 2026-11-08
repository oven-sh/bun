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

fn env_string_store_put(
    store: &mut UserDefinesArray,
    bump: &bun_alloc::Arena,
    key: &[u8],
    value: &[u8],
) -> Result<(), crate::Error> {
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
    let data = DefineData::init(Options {
        value,
        can_be_removed_if_unused: true,
        call_can_be_unwrapped_if_unused: bun_ast::E::CallUnwrap::IfUnused,
        ..Default::default()
    });
    store.get_or_put_value(key, data)?;
    Ok(())
}

/// Copies `process.env.*` entries from the dotenv loader into `to_string`
/// according to `behavior` (all of them, or only those starting with `prefix`).
pub(crate) fn copy_env_for_define(
    env: &bun_dotenv::Loader,
    to_string: &mut UserDefinesArray,
    behavior: bun_dotenv::DotEnvBehavior,
    prefix: &[u8],
    bump: &bun_alloc::Arena,
) -> Result<(), crate::Error> {
    use bun_dotenv::DotEnvBehavior;
    const PROCESS_ENV: &[u8] = b"process.env.";

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
        key_buf.clear();
        key_buf.extend_from_slice(PROCESS_ENV);
        key_buf.extend_from_slice(k);
        env_string_store_put(to_string, bump, &key_buf, &v.value)?;
    }

    Ok(())
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
    use super::*;

    // What `\s` matches.
    const WHITESPACE: [char; 25] = [
        '\t', '\n', '\x0b', '\x0c', '\r', ' ', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}',
        '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}',
        '\u{2009}', '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}',
        '\u{feff}',
    ];

    /// What `text` is as the value of a define, and how many messages it logged.
    fn parse(text: &str) -> (String, usize) {
        bun_ast::initialize_store_or_reset();
        let _reset = bun_ast::StoreResetGuard::new();
        let arena = bun_alloc::Arena::new();
        let mut log = bun_ast::Log::default();
        let parsed = DefineData::parse(b"K", text.as_bytes(), false, false, &mut log, &arena);
        let value = match parsed.map(|data| data.value) {
            Err(_) => "error".to_owned(),
            Ok(ExprData::EBoolean(boolean)) => boolean.value.to_string(),
            Ok(ExprData::ENull(_)) => "null".to_owned(),
            Ok(ExprData::EUndefined(_)) => "undefined".to_owned(),
            Ok(ExprData::ENumber(number)) => number.value().to_string(),
            Ok(ExprData::EString(string)) if string.is_utf16 => {
                format!("\"{}\"", String::from_utf16_lossy(string.slice16()))
            }
            Ok(ExprData::EString(string)) => {
                format!("\"{}\"", String::from_utf8_lossy(string.slice8()))
            }
            Ok(ExprData::EArray(array)) => format!("array of {}", array.items.len()),
            Ok(ExprData::EObject(object)) => format!("object of {}", object.properties.len()),
            Ok(ExprData::EIdentifier(_)) => "identifier".to_owned(),
            Ok(_) => "another kind".to_owned(),
        };
        (value, log.msgs.len())
    }

    fn read(text: &str) -> String {
        parse(text).0
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn whitespace_around_one_whole_value_is_not_part_of_it() {
        // One value for each first byte that `parse_env_json` reads as JSON, and each keyword.
        for (value, read_as) in [
            ("false", "false"),
            ("true", "true"),
            ("null", "null"),
            ("undefined", "undefined"),
            ("0", "0"),
            ("1", "1"),
            ("2", "2"),
            ("3", "3"),
            ("4", "4"),
            ("5", "5"),
            ("6", "6"),
            ("7", "7"),
            ("8", "8"),
            ("9", "9"),
            ("-1", "-1"),
            ("- 1", "-1"),
            (".5", "0.5"),
            ("-.5", "-0.5"),
            ("1e3", "1000"),
            ("0x10", "16"),
            ("01", "1"),
            ("1_000", "1000"),
            ("\"s\"", "\"s\""),
            ("'s'", "\"s\""),
            ("{}", "object of 0"),
            ("{\"a\":1,}", "object of 1"),
            ("[1]", "array of 1"),
            ("[1, 2,]", "array of 2"),
        ] {
            assert_eq!(read(value), read_as, "{value:?}");
            for space in WHITESPACE {
                for text in [
                    format!("{space}{value}"),
                    format!("{space}{value}{space}"),
                    format!("{space}\r\n {space}{value}\n"),
                ] {
                    assert_eq!(read(&text), read_as, "{text:?}");
                }
            }
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn other_text_behind_whitespace_is_the_string_it_was() {
        for text in [
            // It starts as a value does, and it is not one.
            "1.2.3",
            "2026-11-07",
            "1px",
            "10%",
            "1/2",
            "12abc",
            "1n",
            "1e",
            "0x",
            "1..2",
            "{a:1}",
            "[",
            "{",
            "\"",
            "\"unclosed",
            // One value, and more text.
            "7 days",
            "1 2",
            "1,2",
            "1 // c",
            "false x",
            "true-ish",
            "true;",
            "null,",
            "undefined x",
            "[1] x",
            "{} x",
            "1\"",
            // A name, and other text.
            "production",
            "a.b.c",
            "NaN",
            "falsy",
            "two words",
            "http://x/y",
            "-abc",
            "(1)",
            "a+b",
            "",
        ] {
            for space in WHITESPACE {
                let text = format!("{space}{text}");
                assert_eq!(parse(&text), (format!("\"{text}\""), 0), "{text:?}");
            }
        }
        // A backslash is read as it is with nothing before the whitespace.
        assert_eq!(read(" \\u0066alse"), "\" false\"");
        assert_eq!(read(" false\\"), "\" false\"");
        assert_eq!(read(" \\\"s\\\""), "\" \"s\"\"");
        // Not whitespace.
        assert_eq!(read("\u{85}false"), "\"\u{85}false\"");
        assert_eq!(read("\u{200b}false"), "\"\u{200b}false\"");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn only_a_whole_value_behind_whitespace_logs_its_warning() {
        assert_eq!(parse("{\"a\":1,\"a\":2}"), ("object of 2".to_owned(), 1));
        assert_eq!(parse(" {\"a\":1,\"a\":2}"), ("object of 2".to_owned(), 1));
        // What the parser logs about a text that is not one value is dropped.
        assert_eq!(
            parse(" {\"a\":1,\"a\":2} x"),
            ("\" {\"a\":1,\"a\":2} x\"".to_owned(), 0)
        );
    }
}
