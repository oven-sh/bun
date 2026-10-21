#![warn(unused_must_use)]
#![forbid(unsafe_code)]

use bun_ast::Loc;

// ──────────────────────────────────────────────────────────────────────────
// Pure-byte helpers. They touch no parser state; exposed as free fns so
// they are unit-testable without the Expr-carrying struct.
// ──────────────────────────────────────────────────────────────────────────

/// npm's `ini` trims keys, values and section names with `String.prototype.trim`, whose set is wider than ASCII whitespace.
pub(crate) use bun_core::strings::{
    trim_js_whitespace, trim_js_whitespace_end as trim_js_whitespace_right,
};

#[inline]
pub(crate) fn should_skip_line(line: &[u8]) -> bool {
    let line = trim_js_whitespace(line);
    line.is_empty() || line[0] == b';' || line[0] == b'#'
}

#[inline]
pub(crate) fn is_quoted(val: &[u8]) -> bool {
    (bun_core::starts_with_char(val, b'"') && bun_core::ends_with_char(val, b'"'))
        || (bun_core::starts_with_char(val, b'\'') && bun_core::ends_with_char(val, b'\''))
}

#[inline]
pub(crate) fn next_dot(key: &[u8]) -> Option<usize> {
    bun_core::strings::index_of_char_usize(key, b'.')
}

/// Index of the first `;` or `#` that a backslash does not escape.
pub(crate) fn inline_comment_start(val: &[u8]) -> Option<usize> {
    let mut from = 0;
    while let Some(at) = bun_core::strings::index_of_any_pos(val, b"\\;#", from) {
        if val[at] != b'\\' {
            return Some(at);
        }
        from = at + 2;
    }
    None
}

// ──────────────────────────────────────────────────────────────────────────
// ConfigOpt
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
pub enum ConfigOpt {
    /// usually `${username}:${password}` encoded in base64, but sent verbatim
    #[strum(serialize = "_auth")]
    _Auth,

    /// authentication string
    #[strum(serialize = "_authToken")]
    _AuthToken,

    #[strum(serialize = "username")]
    Username,

    /// this is encoded as base64 in .npmrc
    #[strum(serialize = "_password")]
    _Password,

    #[strum(serialize = "email")]
    Email,

    /// path to certificate file
    #[strum(serialize = "certfile")]
    Certfile,

    /// path to key file
    #[strum(serialize = "keyfile")]
    Keyfile,
}

// ──────────────────────────────────────────────────────────────────────────
// ConfigItem
// ──────────────────────────────────────────────────────────────────────────

/// One `//<key>:<opt>=<value>` line. The lines of every `.npmrc` go into one list, as npm collapses its files into one map.
pub(crate) struct ConfigItem {
    /// The text between `//` and `:<opt>=`, after `normalize_key`. From then on it's compared byte
    /// for byte.
    pub(crate) registry_url: Box<[u8]>,
    pub(crate) optname: ConfigOpt,
    pub(crate) value: Box<[u8]>,
    pub(crate) loc: Loc,
    /// The index of the file that `load_npmrc_config` parsed this from. Used for diagnostics.
    pub(crate) source_idx: u32,
}

// ──────────────────────────────────────────────────────────────────────────
// NodeLinkerMap
// ──────────────────────────────────────────────────────────────────────────

use bun_install_types::NodeLinker::NodeLinker;

bun_core::comptime_string_map! {
    static NODE_LINKER_MAP: NodeLinker = {
        // yarn
        b"pnpm" => NodeLinker::Isolated,
        b"node-modules" => NodeLinker::Hoisted,
        // pnpm
        b"isolated" => NodeLinker::Isolated,
        b"hoisted" => NodeLinker::Hoisted,
    };
}

pub use draft::{
    NpmrcDiagnostics, Parser, RegistryKey, load_npmrc, load_npmrc_config, npm_config_bool,
    npmrc_bool,
};

mod draft {

    use core::fmt;
    use core::ptr;

    use bun_alloc::{AllocError, Arena, ArenaVec, ArenaVecExt as _};
    use bun_ast::E::Rope;
    use bun_ast::{E, Expr, ExprData, StoreRef};
    use bun_ast::{Loc, Log, Source};
    use bun_collections::VecExt;
    use bun_core::{Output, ZStr};
    use bun_dotenv::Loader as DotEnvLoader;
    use bun_options_types::schema::api::{BunInstall, Ca, NpmRegistry, NpmUrlAuth};
    use bun_url::URL;

    use super::{
        ConfigItem, ConfigOpt, NODE_LINKER_MAP, NodeLinker, inline_comment_start, is_quoted,
        next_dot, should_skip_line, trim_js_whitespace, trim_js_whitespace_right,
    };

    type OOM<T> = Result<T, AllocError>;

    /// Hard cap on dot-separated segments in a section-header rope. The rope is
    /// consumed by `E::Object::get_or_put_object`, which recurses once per
    /// `rope.next` link, so an unbounded header overflows the stack. Past the
    /// cap the remainder of the header (dots included) becomes the final
    /// segment.
    const MAX_SECTION_ROPE_SEGMENTS: usize = 512;

    // ──────────────────────────────────────────────────────────────────────────
    // Parser
    // ──────────────────────────────────────────────────────────────────────────

    pub struct Parser<'a> {
        pub(crate) source: &'a Source,
        pub(crate) src: &'a [u8],
        pub out: Expr,
        pub(crate) env: &'a DotEnvLoader,
    }

    // The result type depends on the usage (`.section -> *Rope`, `.key ->
    // bytes`, `.value -> Expr`). Rust
    // const generics cannot select a return type, so we keep a single
    // `prepare_str::<USAGE>()` body and wrap the result in
    // `PrepareResult`. Callers unwrap with `.into_*()`.
    //
    // `#[derive(ConstParamTy)]` requires nightly `adt_const_params`.
    // Dropped to a runtime arg (the body never uses USAGE in a type position).
    #[derive(PartialEq, Eq, Clone, Copy)]
    enum Usage {
        Section,
        Key,
        Value,
    }

    enum PrepareResult<'bump> {
        Value(Expr),
        Section(&'bump mut Rope),
        Key(&'bump [u8]),
    }

    impl<'bump> PrepareResult<'bump> {
        bun_core::enum_unwrap!(PrepareResult, Value   => into fn into_value   -> Expr);
        bun_core::enum_unwrap!(PrepareResult, Section => into fn into_section -> &'bump mut Rope);
        bun_core::enum_unwrap!(PrepareResult, Key     => into fn into_key     -> &'bump [u8]);
    }

    impl<'a> Parser<'a> {
        pub fn init(source: &'a Source, env: &'a DotEnvLoader) -> Parser<'a> {
            Parser {
                src: source.contents.as_ref(),
                out: Expr::init(E::Object::default(), Loc::EMPTY),
                source,
                env,
            }
        }

        // deinit -> Drop: `logger` is owned and drops automatically.

        pub fn parse(&mut self, bump: &'a Arena) -> OOM<()> {
            let src = self.src;
            let env = self.env;
            let source_path = self.source.path.text;
            let mut iter = bun_core::strings::split(src, b"\n");
            // `StoreRef` is the arena-backed handle `ExprData` already stores;
            // it is `Copy`, so keeping the root and the current-section head as
            // separate values is a split borrow, not an alias.
            let root: StoreRef<E::Object> =
                self.out.data.e_object().expect("Parser.out is E.Object");
            let mut head: StoreRef<E::Object> = root;

            let ropealloc = bump;

            let mut skip_until_next_section = false;

            while let Some(line_) = iter.next() {
                let line = if !line_.is_empty() && line_[line_.len() - 1] == b'\r' {
                    &line_[..line_.len() - 1]
                } else {
                    line_
                };
                if should_skip_line(line) {
                    continue;
                }

                // Section
                // [foo]
                if line[0] == b'[' {
                    let mut treat_as_key = false;
                    'treat_as_key: {
                        skip_until_next_section = false;
                        let Some(close_bracket_idx) =
                            bun_core::strings::index_of_char_usize(line, b']')
                        else {
                            // Skip the whole line: treat_as_key stays false and
                            // we fall through to `continue` below.
                            break 'treat_as_key;
                        };
                        // Make sure the rest is just whitespace
                        if !trim_js_whitespace(&line[close_bracket_idx + 1..]).is_empty() {
                            treat_as_key = true;
                            break 'treat_as_key;
                        }
                        let offset = i32::try_from(line.as_ptr() as usize - src.as_ptr() as usize)
                            .unwrap()
                            + 1;
                        let section: &mut Rope = Self::prepare_str(
                            env,
                            source_path,
                            Usage::Section,
                            bump,
                            ropealloc,
                            &line[1..close_bracket_idx],
                            offset,
                        )?
                        .into_section();
                        let mut r = root;
                        let parent_object = match r.get_or_put_object(section, bump) {
                            Ok(v) => v,
                            Err(E::SetError::OutOfMemory) => return Err(AllocError),
                            Err(E::SetError::Clobber) => {
                                // We're in here if key exists but it is not an object
                                //
                                // This is possible if someone did:
                                //
                                // ```ini
                                // foo = 'bar'
                                //
                                // [foo]
                                // hello = 420
                                // ```
                                //
                                // In the above case, `this.out[section]` would be a string.
                                // So what should we do in that case?
                                //
                                // npm/ini's will chug along happily trying to assign keys to the string.
                                //
                                // In JS assigning keys to string does nothing.
                                //
                                // Technically, this would have an effect if the value was an array:
                                //
                                // ```ini
                                // foo[] = 0
                                // foo[] = 1
                                //
                                // [foo]
                                // 0 = 420
                                // ```
                                //
                                // This would result in `foo` being `[420, 1]`.
                                //
                                // To be honest this is kind of crazy behavior so we're just going to skip this for now.
                                skip_until_next_section = true;
                                break 'treat_as_key;
                            }
                        };
                        head = parent_object
                            .data
                            .e_object()
                            .expect("get_or_put_object returns E.Object");
                        break 'treat_as_key;
                    }
                    if !treat_as_key {
                        continue;
                    }
                }
                if skip_until_next_section {
                    continue;
                }

                // Otherwise it's a key val here

                let line_offset = i32::try_from(line.as_ptr() as usize - src.as_ptr() as usize)
                    .expect("int cast");

                let maybe_eq_sign_idx = bun_core::strings::index_of_char_usize(line, b'=');

                let key_raw: &[u8] = Self::prepare_str(
                    env,
                    source_path,
                    Usage::Key,
                    bump,
                    ropealloc,
                    &line[..maybe_eq_sign_idx.unwrap_or(line.len())],
                    line_offset,
                )?
                .into_key();
                let is_array: bool =
                    key_raw.len() > 2 && bun_core::strings::ends_with(key_raw, b"[]");

                let key = if is_array && bun_core::strings::ends_with(key_raw, b"[]") {
                    &key_raw[..key_raw.len() - 2]
                } else {
                    key_raw
                };

                if key == b"__proto__" {
                    continue;
                }

                let value_raw: Expr = 'brk: {
                    if let Some(eq_sign_idx) = maybe_eq_sign_idx {
                        if eq_sign_idx + 1 < line.len() {
                            break 'brk Self::prepare_str(
                                env,
                                source_path,
                                Usage::Value,
                                bump,
                                ropealloc,
                                &line[eq_sign_idx + 1..],
                                line_offset + i32::try_from(eq_sign_idx).expect("int cast") + 1,
                            )?
                            .into_value();
                        }
                        break 'brk Expr::init(E::EString::init(b""), Loc::EMPTY);
                    }
                    Expr::init(E::Boolean { value: true }, Loc::EMPTY)
                };

                let value: Expr = match &value_raw.data {
                    ExprData::EString(s) => {
                        if s.data == b"true" {
                            Expr::init(E::Boolean { value: true }, Loc::EMPTY)
                        } else if s.data == b"false" {
                            Expr::init(E::Boolean { value: false }, Loc::EMPTY)
                        } else if s.data == b"null" {
                            Expr::init(E::Null, Loc::EMPTY)
                        } else {
                            value_raw
                        }
                    }
                    _ => value_raw,
                };

                if is_array {
                    if let Some(val) = E::Object::get(&head, key) {
                        if !matches!(val.data, ExprData::EArray(_)) {
                            let mut arr = E::Array::default();
                            arr.push(bump, val)?;
                            head.put(bump, key, Expr::init(arr, Loc::EMPTY))?;
                        }
                    } else {
                        head.put(bump, key, Expr::init(E::Array::default(), Loc::EMPTY))?;
                    }
                }

                // safeguard against resetting a previously defined
                // array by accidentally forgetting the brackets
                let mut was_already_array = false;
                if let Some(mut val) = E::Object::get(&head, key) {
                    if matches!(val.data, ExprData::EArray(_)) {
                        was_already_array = true;
                        val.data
                            .e_array_mut()
                            .expect("infallible: variant checked")
                            .push(bump, value)?;
                        head.put(bump, key, val)?;
                    }
                }
                if !was_already_array {
                    head.put(bump, key, value)?;
                }
            }
            Ok(())
        }

        fn prepare_str(
            env: &DotEnvLoader,
            source_path: &[u8],
            usage: Usage,
            bump: &'a Arena,
            ropealloc: &'a Arena,
            val_: &'a [u8],
            offset_: i32,
        ) -> OOM<PrepareResult<'a>> {
            let mut offset = offset_;
            let mut val = trim_js_whitespace(val_);

            if is_quoted(val) {
                'out: {
                    // remove single quotes before calling JSON.parse
                    if !val.is_empty() && val[0] == b'\'' {
                        val = if val.len() > 1 {
                            &val[1..val.len() - 1]
                        } else {
                            &val[1..]
                        };
                        offset += 1;
                    }
                    // JSON.parse("") would throw; json::parse_utf8 returns the
                    // shared EMPTY_OBJECT static, which a later [section] write
                    // could then mutate. Fall through to the string path instead.
                    if val.is_empty() {
                        break 'out;
                    }
                    // `bun_parsers::json::parse_utf8_impl` returns the T2
                    // value-subset `bun_ast::Expr`; lift it into the T4
                    // `bun_ast::Expr` (via the `From` impl in
                    // `bun_ast::expr`) so the rest of this body works
                    // against a single `ExprData`.
                    let src = Source::init_path_string(source_path, val);
                    let mut log = Log::init();
                    // Try to parse it and if it fails will just treat it as a string
                    let json_val: Expr =
                        match bun_parsers::json::parse_utf8_impl::<true>(&src, &mut log, bump) {
                            Ok(v) => v,
                            Err(_) => {
                                // JSON parse failed (e.g., single-quoted string like '${VAR}')
                                // Still need to expand env vars in the content
                                if usage == Usage::Value {
                                    let expanded = Self::expand_env_vars(env, bump, val)?;
                                    return Ok(PrepareResult::Value(Expr::init(
                                        E::EString::init(expanded),
                                        Loc { start: offset },
                                    )));
                                }
                                break 'out;
                            }
                        };
                    drop(log);

                    if let ExprData::EString(s) = &json_val.data {
                        let str_ = s.string(bump)?;
                        // Expand env vars in the JSON-parsed string
                        let expanded = if usage == Usage::Value {
                            Self::expand_env_vars(env, bump, str_)?
                        } else {
                            str_
                        };
                        if usage == Usage::Value {
                            return Ok(PrepareResult::Value(Expr::init(
                                E::EString::init(expanded),
                                Loc { start: offset },
                            )));
                        }
                        if usage == Usage::Section {
                            return Ok(PrepareResult::Section(Self::str_to_rope(
                                ropealloc, expanded,
                            )?));
                        }
                        return Ok(PrepareResult::Key(expanded));
                    }

                    if usage == Usage::Value {
                        // The parsed Expr is returned as-is, preserving
                        // `E.Array`/`E.Object` tags so downstream `.e_array`/
                        // `.e_object` checks (e.g. loadNpmrc
                        // `ca`/`omit`/`include`) fire. `json_val` was lifted to T4
                        // at the parse site above.
                        return Ok(PrepareResult::Value(Expr {
                            loc: Loc { start: offset },
                            data: json_val.data,
                        }));
                    }

                    // unfortunately, we need to match npm/ini behavior here,
                    // which requires us to turn these into a string,
                    // same behavior as doing this:
                    // ```
                    // let foo = {}
                    // const json_val = { hi: 'hello' }
                    // foo[json_val] = 'nice'
                    // ```
                    match &json_val.data {
                        ExprData::EObject(_) => {
                            if usage == Usage::Section {
                                return Ok(PrepareResult::Section(Self::single_str_rope(
                                    ropealloc,
                                    b"[Object object]",
                                )?));
                            }
                            return Ok(PrepareResult::Key(b"[Object object]"));
                        }
                        _ => {
                            // Cold
                            // npm-quirk path (JSON array/number used as a section
                            // header or key); format to a temp `String` then copy
                            // into the arena.
                            let s = format!("{}", ToStringFormatter { d: &json_val.data });
                            let str_ = bump.alloc_slice_copy(s.as_bytes());
                            if usage == Usage::Section {
                                return Ok(PrepareResult::Section(Self::single_str_rope(
                                    ropealloc, str_,
                                )?));
                            }
                            return Ok(PrepareResult::Key(str_));
                        }
                    }
                }
            } else {
                const STACK_BUF_SIZE: usize = 1024;
                // walk the val to find the first non-escaped comment character (; or #)
                let mut did_any_escape = false;
                let mut esc = false;
                let mut comment_cut = false;
                let mut unesc = ArenaVec::<u8>::with_capacity_in(STACK_BUF_SIZE, bump);

                // RopeT is *Rope when usage==Section, else unit. In Rust we just
                // keep an Option<&mut Rope> and ignore it for non-section usages.
                let mut rope: Option<&'a mut Rope> = None;
                let mut rope_parts: usize = 0;

                let mut i: usize = 0;
                'walk: while i < val.len() {
                    let c = val[i];
                    if esc {
                        match c {
                            b'\\' => unesc.extend_from_slice(b"\\"),
                            b';' | b'#' | b'$' => unesc.push(c),
                            b'.' => {
                                if usage == Usage::Section {
                                    unesc.push(b'.');
                                } else {
                                    unesc.extend_from_slice(b"\\.");
                                }
                            }
                            _ => match bun_core::utf8_byte_sequence_length(c) {
                                0 | 1 => unesc.extend_from_slice(&[b'\\', c]),
                                2 => {
                                    if val.len() - i >= 2 {
                                        unesc.extend_from_slice(&[b'\\', c, val[i + 1]]);
                                        i += 1;
                                    } else {
                                        unesc.extend_from_slice(&[b'\\', c]);
                                    }
                                }
                                3 => {
                                    if val.len() - i >= 3 {
                                        unesc.extend_from_slice(&[
                                            b'\\',
                                            c,
                                            val[i + 1],
                                            val[i + 2],
                                        ]);
                                        i += 2;
                                    } else {
                                        unesc.push(b'\\');
                                        unesc.extend_from_slice(&val[i..val.len()]);
                                        i = val.len() - 1;
                                    }
                                }
                                4 => {
                                    if val.len() - i >= 4 {
                                        unesc.extend_from_slice(&[
                                            b'\\',
                                            c,
                                            val[i + 1],
                                            val[i + 2],
                                            val[i + 3],
                                        ]);
                                        i += 3;
                                    } else {
                                        unesc.push(b'\\');
                                        unesc.extend_from_slice(&val[i..val.len()]);
                                        i = val.len() - 1;
                                    }
                                }
                                _ => unreachable!(),
                            },
                        }

                        esc = false;
                    } else {
                        match c {
                            b'$' => {
                                'not_env_substitution: {
                                    if usage != Usage::Value {
                                        break 'not_env_substitution;
                                    }

                                    // npm cuts the comment before it expands `${VAR}`, so the trim never touches the variable's own whitespace.
                                    if !comment_cut {
                                        comment_cut = true;
                                        if let Some(at) = inline_comment_start(&val[i..]) {
                                            val = trim_js_whitespace_right(&val[..i + at]);
                                        }
                                    }

                                    if let Some(new_i) =
                                        Self::parse_env_substitution(env, val, i, i, 0, &mut unesc)?
                                    {
                                        // set to true so we heap alloc
                                        did_any_escape = true;
                                        i = new_i;
                                        i += 1;
                                        continue 'walk;
                                    }
                                }
                                unesc.push(b'$');
                            }
                            b';' | b'#' => {
                                // the rest of the line is a comment (ini `unsafe()`)
                                let kept = trim_js_whitespace_right(&unesc).len();
                                unesc.truncate(kept);
                                did_any_escape = true;
                                break;
                            }
                            b'\\' => {
                                esc = true;
                                did_any_escape = true;
                            }
                            b'.' => {
                                if usage == Usage::Section && rope_parts < MAX_SECTION_ROPE_SEGMENTS
                                {
                                    Self::commit_rope_part(bump, ropealloc, &mut unesc, &mut rope)?;
                                    rope_parts += 1;
                                } else {
                                    unesc.push(b'.');
                                }
                            }
                            _ => match bun_core::utf8_byte_sequence_length(c) {
                                0 | 1 => unesc.push(c),
                                2 => {
                                    if val.len() - i >= 2 {
                                        unesc.extend_from_slice(&[c, val[i + 1]]);
                                        i += 1;
                                    } else {
                                        unesc.push(c);
                                    }
                                }
                                3 => {
                                    if val.len() - i >= 3 {
                                        unesc.extend_from_slice(&[c, val[i + 1], val[i + 2]]);
                                        i += 2;
                                    } else {
                                        unesc.extend_from_slice(&val[i..val.len()]);
                                        i = val.len() - 1;
                                    }
                                }
                                4 => {
                                    if val.len() - i >= 4 {
                                        unesc.extend_from_slice(&[
                                            c,
                                            val[i + 1],
                                            val[i + 2],
                                            val[i + 3],
                                        ]);
                                        i += 3;
                                    } else {
                                        unesc.extend_from_slice(&val[i..val.len()]);
                                        i = val.len() - 1;
                                    }
                                }
                                _ => unreachable!(),
                            },
                        }
                    }
                    i += 1;
                }

                if esc {
                    unesc.push(b'\\');
                }

                match usage {
                    Usage::Section => {
                        Self::commit_rope_part(bump, ropealloc, &mut unesc, &mut rope)?;
                        return Ok(PrepareResult::Section(rope.unwrap()));
                    }
                    Usage::Value => {
                        if !did_any_escape {
                            return Ok(PrepareResult::Value(Expr::init(
                                E::EString::init(val),
                                Loc { start: offset },
                            )));
                        }
                        if unesc.len() <= STACK_BUF_SIZE {
                            return Ok(PrepareResult::Value(Expr::init(
                                E::EString::init(bump.alloc_slice_copy(&unesc)),
                                Loc { start: offset },
                            )));
                        }
                        return Ok(PrepareResult::Value(Expr::init(
                            E::EString::init(unesc.into_bump_slice()),
                            Loc { start: offset },
                        )));
                    }
                    Usage::Key => {
                        let thestr: &[u8] = 'thestr: {
                            if !did_any_escape {
                                break 'thestr bump.alloc_slice_copy(val);
                            }
                            if unesc.len() <= STACK_BUF_SIZE {
                                break 'thestr bump.alloc_slice_copy(&unesc);
                            }
                            unesc.into_bump_slice()
                        };
                        return Ok(PrepareResult::Key(thestr));
                    }
                }
            }
            // fallthrough from `break 'out` above
            if usage == Usage::Value {
                return Ok(PrepareResult::Value(Expr::init(
                    E::EString::init(val),
                    Loc { start: offset },
                )));
            }
            if usage == Usage::Key {
                // `val` is a subslice of `val_: &'a [u8]`; return the borrow
                // directly.
                return Ok(PrepareResult::Key(val));
            }
            Ok(PrepareResult::Section(Self::str_to_rope(ropealloc, val)?))
        }

        /// Expands ${VAR} and ${VAR?} environment variable substitutions in a string.
        /// Used for quoted values after JSON parsing has already handled escape sequences.
        ///
        /// Behavior (same as unquoted):
        /// - ${VAR} - if VAR is undefined, leave as "${VAR}" (no expansion)
        /// - ${VAR?} - if VAR is undefined, expand to empty string
        /// - Backslash escaping is already handled by JSON parsing
        fn expand_env_vars(env: &DotEnvLoader, bump: &'a Arena, val: &'a [u8]) -> OOM<&'a [u8]> {
            // Quick check if there are any env vars to expand
            if bun_core::index_of(val, b"${").is_none() {
                // Nothing to expand: return the borrow directly.
                return Ok(val);
            }

            let mut result = ArenaVec::<u8>::with_capacity_in(val.len(), bump);
            let mut i: usize = 0;
            while i < val.len() {
                if val[i] == b'$' && i + 2 < val.len() && val[i + 1] == b'{' {
                    // Find the closing brace
                    let mut j = i + 2;
                    let mut depth: usize = 1;
                    while j < val.len() && depth > 0 {
                        if val[j] == b'{' {
                            depth += 1;
                        } else if val[j] == b'}' {
                            depth -= 1;
                        }
                        if depth > 0 {
                            j += 1;
                        }
                    }
                    if depth == 0 {
                        let env_var_raw = &val[i + 2..j];
                        let optional =
                            !env_var_raw.is_empty() && env_var_raw[env_var_raw.len() - 1] == b'?';
                        let env_var = if optional {
                            &env_var_raw[..env_var_raw.len() - 1]
                        } else {
                            env_var_raw
                        };

                        if let Some(expanded) = env.get(env_var) {
                            result.extend_from_slice(expanded);
                        } else if !optional {
                            // Not found and not optional: leave as-is
                            result.extend_from_slice(&val[i..j + 1]);
                        }
                        // If optional and not found: expand to empty string (append nothing)
                        i = j + 1;
                        continue;
                    }
                }
                result.push(val[i]);
                i += 1;
            }
            Ok(result.into_bump_slice())
        }

        /// Returns index to skip or null if not an env substitution
        /// Invariants:
        /// - `i` must be an index into `val` that points to a '$' char
        ///
        /// npm/ini uses a regex pattern that will select the inner most ${...}
        /// Supports ${VAR} and ${VAR?} syntax:
        /// - ${VAR} - if undefined, returns null (leaves as-is)
        /// - ${VAR?} - if undefined, expands to empty string
        fn parse_env_substitution(
            env: &DotEnvLoader,
            val: &[u8],
            start: usize,
            i: usize,
            depth: usize,
            unesc: &mut ArenaVec<'a, u8>,
        ) -> OOM<Option<usize>> {
            debug_assert!(val[i] == b'$');
            const MAX_ENV_SUBSTITUTION_DEPTH: usize = 32;
            if depth >= MAX_ENV_SUBSTITUTION_DEPTH {
                return Ok(None);
            }
            let mut esc = false;
            if i + b"{}".len() < val.len() && val[i + 1] == b'{' {
                let mut found_closing = false;
                let mut j = i + 2;
                while j < val.len() {
                    match val[j] {
                        b'\\' => esc = !esc,
                        b'$' => {
                            if !esc {
                                return Self::parse_env_substitution(
                                    env,
                                    val,
                                    start,
                                    j,
                                    depth + 1,
                                    unesc,
                                );
                            }
                        }
                        b'{' => {
                            if !esc {
                                return Ok(None);
                            }
                        }
                        b'}' => {
                            if !esc {
                                found_closing = true;
                                break;
                            }
                        }
                        _ => {}
                    }
                    j += 1;
                }

                if !found_closing {
                    return Ok(None);
                }

                if start != i {
                    let missed = &val[start..i];
                    unesc.extend_from_slice(missed);
                }

                let env_var_raw = &val[i + 2..j];
                let optional =
                    !env_var_raw.is_empty() && env_var_raw[env_var_raw.len() - 1] == b'?';
                let env_var = if optional {
                    &env_var_raw[..env_var_raw.len() - 1]
                } else {
                    env_var_raw
                };

                // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/workspaces/config/lib/env-replace.js#L6
                if let Some(expanded) = env.get(env_var) {
                    unesc.extend_from_slice(expanded);
                } else if !optional {
                    // Not found and not optional: return null to leave as-is
                    return Ok(None);
                }
                // If optional and not found: expand to empty string (append nothing)

                return Ok(Some(j));
            }
            Ok(None)
        }

        fn single_str_rope(ropealloc: &'a Arena, str_: &[u8]) -> OOM<&'a mut Rope> {
            let rope = ropealloc.alloc(Rope {
                head: Expr::init(E::EString::init(str_), Loc::EMPTY),
                next: ptr::null_mut(),
            });
            Ok(rope)
        }

        fn commit_rope_part(
            bump: &'a Arena,
            ropealloc: &'a Arena,
            unesc: &mut ArenaVec<'a, u8>,
            existing_rope: &mut Option<&'a mut Rope>,
        ) -> OOM<()> {
            let slice = bump.alloc_slice_copy(&unesc[..]);
            let expr = Expr::init(E::EString::init(slice), Loc::EMPTY);
            if let Some(r) = existing_rope.as_deref_mut() {
                let _ = r.append(expr, ropealloc)?;
            } else {
                *existing_rope = Some(ropealloc.alloc(Rope {
                    head: expr,
                    next: ptr::null_mut(),
                }));
            }
            unesc.clear();
            Ok(())
        }

        fn str_to_rope(ropealloc: &'a Arena, key: &[u8]) -> OOM<&'a mut Rope> {
            let Some(mut dot_idx) = next_dot(key) else {
                let rope = ropealloc.alloc(Rope {
                    head: Expr::init(E::EString::init(key), Loc::EMPTY),
                    next: ptr::null_mut(),
                });
                return Ok(rope);
            };
            let rope_head: &'a mut Rope = ropealloc.alloc(Rope {
                head: Expr::init(E::EString::init(&key[..dot_idx]), Loc::EMPTY),
                next: ptr::null_mut(),
            });

            let mut segments: usize = 1;
            while dot_idx + 1 < key.len() {
                let next_dot_idx = match next_dot(&key[dot_idx + 1..]) {
                    Some(n) if segments < MAX_SECTION_ROPE_SEGMENTS => dot_idx + 1 + n,
                    _ => {
                        let rest = &key[dot_idx + 1..];
                        let _ = rope_head
                            .append(Expr::init(E::EString::init(rest), Loc::EMPTY), ropealloc)?;
                        break;
                    }
                };
                let part = &key[dot_idx + 1..next_dot_idx];
                let _ =
                    rope_head.append(Expr::init(E::EString::init(part), Loc::EMPTY), ropealloc)?;
                segments += 1;
                dot_idx = next_dot_idx;
            }

            Ok(rope_head)
        }
    }

    // `IniTestingAPIs` — *_jsc alias deleted (see PORTING.md "Idiom map").

    // ──────────────────────────────────────────────────────────────────────────
    // ToStringFormatter
    // ──────────────────────────────────────────────────────────────────────────

    pub(crate) struct ToStringFormatter<'a> {
        pub(crate) d: &'a ExprData,
    }

    impl fmt::Display for ToStringFormatter<'_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self.d {
                ExprData::EArray(arr) => {
                    let items = arr.items.slice();
                    let last = items.len().saturating_sub(1);
                    for (i, e) in items.iter().enumerate() {
                        let is_last = i == last;
                        write!(
                            writer,
                            "{}{}",
                            ToStringFormatter { d: &e.data },
                            if is_last { "" } else { "," }
                        )?;
                    }
                    Ok(())
                }
                ExprData::EObject(_) => write!(writer, "[Object object]"),
                ExprData::EBoolean(b) => {
                    write!(writer, "{}", if b.value { "true" } else { "false" })
                }
                ExprData::ENumber(n) => write!(writer, "{}", n.value()),
                ExprData::EString(s) => {
                    write!(writer, "{}", bstr::BStr::new(&s.data))
                }
                ExprData::ENull(_) => write!(writer, "null"),

                other => {
                    if cfg!(debug_assertions) {
                        Output::panic(format_args!(
                            "Unexpected AST node: {}",
                            <&'static str>::from(other.tag())
                        ));
                    }
                    Ok(())
                }
            }
        }
    }

    /// `word` spells a credential option once case, `_` and `-` are ignored.
    fn folds_to_credential_option(word: &[u8]) -> bool {
        const NAMES: [&[u8]; 4] = [b"_authToken", b"_auth", b"username", b"_password"];
        let fold = |s: &[u8]| -> Vec<u8> {
            s.iter()
                .filter(|&&c| c != b'_' && c != b'-')
                .map(u8::to_ascii_lowercase)
                .collect()
        };
        let folded = fold(word);
        !folded.is_empty() && NAMES.iter().any(|name| fold(name) == folded)
    }

    /// npm's `nerfDart`: removes the scheme, lowercases the host, and drops the port if it's the
    /// default for a scheme that was written out.
    fn normalize_key(raw: &[u8]) -> Box<[u8]> {
        let has_scheme = |scheme: &[u8]| {
            raw.len() >= scheme.len() && raw[..scheme.len()].eq_ignore_ascii_case(scheme)
        };
        let (default_port, rest): (Option<&[u8]>, &[u8]) = if has_scheme(b"https://") {
            (Some(b"443"), &raw[b"https://".len()..])
        } else if has_scheme(b"http://") {
            (Some(b"80"), &raw[b"http://".len()..])
        } else {
            (None, raw)
        };
        let host_end = bun_core::strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
        let mut key = rest.to_vec();
        key[..host_end].make_ascii_lowercase();
        // In a bracketed IPv6 authority only a colon after `]` introduces a port.
        if let Some(default_port) = default_port {
            if let Some(colon) = bun_core::strings::last_index_of_char(&key[..host_end], b':') {
                let is_port = key[0] != b'[' || (colon > 0 && key[colon - 1] == b']');
                if is_port && key[colon + 1..host_end] == *default_port {
                    key.drain(colon..host_end);
                }
            }
        }
        key.into_boxed_slice()
    }

    // ──────────────────────────────────────────────────────────────────────────
    // loadNpmrcConfig / loadNpmrc
    // ──────────────────────────────────────────────────────────────────────────

    /// npm's Boolean coercion (`@npmcli/config` parse-field, then nopt `validateBoolean`).
    pub fn npmrc_bool(expr: &Expr) -> Option<bool> {
        match &expr.data {
            ExprData::EBoolean(b) => Some(b.value),
            ExprData::ENull(_) => Some(false),
            // ini parses a single-quoted value as JSON, so `'1'` is a number and `'{}'` is an
            // object.
            ExprData::ENumber(_) => expr.as_number().map(|n| n != 0.0),
            ExprData::EObject(_) => Some(true),
            ExprData::EString(_) => Some(npm_config_bool(expr.as_utf8_string_literal()?)),
            _ => None,
        }
    }

    /// [`npmrc_bool`] of a string, which is all `npm_config_<key>` in the environment can hold.
    pub fn npm_config_bool(value: &[u8]) -> bool {
        let value = trim_js_whitespace(value);
        if value.is_empty() {
            return true;
        }
        if matches!(value, b"false" | b"null" | b"undefined") {
            return false;
        }
        // Like nopt: a numeric string is `!!Number(value)`, and any other string is true.
        bun_ast::expr::string_to_equivalent_number_value(value) != 0.0
    }

    /// Where the warnings and errors of a `.npmrc` go.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum NpmrcDiagnostics {
        Print,
        /// For runtime auto-install, where stderr belongs to the script.
        Discard,
    }

    /// Reads every `.npmrc` into `install`; `bunfig` only tells the diagnostics which registries exist.
    /// Like npm, skips a file that can't be read.
    pub fn load_npmrc_config(
        install: &mut BunInstall,
        bunfig: &BunInstall,
        env: &DotEnvLoader,
        diagnostics: NpmrcDiagnostics,
        npmrc_paths: &[&ZStr],
    ) {
        let mut log = Log::init();
        let mut configs: Vec<ConfigItem> = Vec::new();
        let mut sources: Vec<Source> = Vec::new();

        for &npmrc_path in npmrc_paths {
            match bun_ast::source_from_file(
                npmrc_path,
                bun_ast::ToSourceOptions { convert_bom: true },
            ) {
                Ok(source) => {
                    if source
                        .check_parseable_len(&mut log, "INI document")
                        .is_err()
                    {
                        report_log(&mut log, diagnostics);
                        continue;
                    }
                    sources.push(source);
                }
                Err(_) => continue,
            }

            let source_idx = sources.len() - 1;
            bun_core::handle_oom(parse_npmrc_into(
                install,
                env,
                &mut log,
                &sources[source_idx],
                source_idx as u32,
                &mut configs,
            ));
            report_log(&mut log, diagnostics);
        }

        resolve_url_auth(install, bunfig, &configs, &sources, &mut log);
        report_log(&mut log, diagnostics);
    }

    /// Prints and clears `log`, under a header that names the file of its first error.
    fn report_log(log: &mut Log, diagnostics: NpmrcDiagnostics) {
        if diagnostics == NpmrcDiagnostics::Discard {
            log.reset();
            return;
        }
        if log.has_errors() {
            let path: &[u8] = log
                .msgs
                .iter()
                .find(|msg| msg.kind == bun_ast::Kind::Err)
                .and_then(|msg| msg.data.location.as_ref())
                .map_or(b"", |loc| &loc.file);
            bun_core::warn!(
                "Encountered {} while reading <b>{}<r>:\n\n",
                if log.errors == 1 {
                    "an error"
                } else {
                    "errors"
                },
                bstr::BStr::new(path),
            );
        }
        let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
            Output::error_writer(),
        ));
        log.reset();
    }

    fn url_or_default(url: &[u8]) -> &[u8] {
        if url.is_empty() {
            bun_install_types::NodeLinker::npm::Registry::DEFAULT_URL.as_bytes()
        } else {
            url
        }
    }

    /// A URL as npm's key walk sees it: its WHATWG serialization without the scheme and the query.
    pub struct RegistryKey {
        /// `<host><path>/`, which is npm's key for the registry itself and where the walk starts.
        key: Box<[u8]>,
        /// `key` with the default port of the URL's scheme written out. Lines like `//host:443/`
        /// are matched before the walk.
        with_default_port: Option<Box<[u8]>>,
    }

    impl RegistryKey {
        pub fn from_url(url_bytes: &[u8]) -> RegistryKey {
            let owned = URL::from_string(&bun_core::String::borrow_utf8(url_bytes)).ok();
            let url = match &owned {
                Some(owned) => owned.url(),
                None => URL::parse(url_bytes),
            };
            RegistryKey::from_parsed(&url)
        }

        /// The key of a URL that is already a WHATWG serialisation, without parsing it again.
        pub fn from_parsed(url: &URL) -> RegistryKey {
            // `pathname` includes the query. `path` doesn't, but it collapses a one-byte path such
            // as `/r/` to `/`.
            let pathname = url.pathname;
            let path_end =
                bun_core::strings::index_of_char_usize(pathname, b'?').unwrap_or(pathname.len());
            let path = pathname[..path_end]
                .strip_suffix(b"/")
                .unwrap_or(&pathname[..path_end]);
            let key_with_port = |port: &[u8]| -> Box<[u8]> {
                let mut key = Vec::with_capacity(url.host.len() + port.len() + path.len() + 1);
                key.extend_from_slice(url.host);
                key.make_ascii_lowercase();
                key.extend_from_slice(port);
                key.extend_from_slice(path);
                key.push(b'/');
                key.into_boxed_slice()
            };
            let default_port: Option<&[u8]> = if !url.port.is_empty() {
                None
            } else if url.is_https() {
                Some(b":443")
            } else if url.is_http() {
                Some(b":80")
            } else {
                None
            };
            RegistryKey {
                key: key_with_port(b""),
                with_default_port: default_port.map(key_with_port),
            }
        }

        /// npm's `regFromURI`. For `https://h/a/`, it yields `h/a/`, `h:443/a/`, `h/a`, `h:443/a`,
        /// ..., `h:443`.
        pub fn walk(&self) -> impl Iterator<Item = &[u8]> {
            let mut next = Some(self.key.len());
            let mut with_default_port: Option<&[u8]> = None;
            core::iter::from_fn(move || {
                if let Some(key) = with_default_port.take() {
                    return Some(key);
                }
                let end = next.take()?;
                let current = &self.key[..end];
                // The port sits right after the host, which is the shortest key of the walk.
                with_default_port = self
                    .with_default_port
                    .as_deref()
                    .map(|key| &key[..end + key.len() - self.key.len()]);
                // npm's `regKey.replace(/([^/]+|\/)$/, '')`
                let shorter = match current.strip_suffix(b"/") {
                    Some(rest) => rest.len(),
                    None => {
                        bun_core::strings::last_index_of_char(current, b'/').map_or(0, |i| i + 1)
                    }
                };
                next = (shorter > 0).then_some(shorter);
                Some(current)
            })
        }
    }

    /// npm's config is a flat map, so a key that's repeated across `.npmrc` files collapses to the
    /// last one read.
    fn lookup<'a>(configs: &'a [ConfigItem], key: &[u8], opt: ConfigOpt) -> Option<&'a ConfigItem> {
        configs
            .iter()
            .rfind(|conf_item| conf_item.optname == opt && *conf_item.registry_url == *key)
    }

    /// npm's `Buffer.from(value, "base64")`, which skips invalid bytes and never fails.
    fn decode_password(value: &[u8]) -> Box<[u8]> {
        // The bytes it would skip include the CR, LF and NUL that `Scope::from_api` refuses, so
        // leave them in for that check.
        if bun_core::strings::contains_any(value, b"\r\n\0") {
            return value.into();
        }
        let mut decoded = vec![0u8; bun_base64::decode_lenient_len(value.len())];
        let count = bun_base64::decode_lenient(&mut decoded[..], value, false);
        decoded.truncate(count);
        decoded.into_boxed_slice()
    }

    /// Follows the order of npm's `hasAuth`, without `certfile` and `keyfile` (no mTLS), which
    /// would stop the walk.
    fn credentials_of_key(configs: &[ConfigItem], key: &[u8]) -> Option<NpmRegistry> {
        // npm's `opts[k]` truthiness test, applied after the collapse, so a later `username=`
        // clears an earlier one.
        let truthy =
            |opt| Some(&lookup(configs, key, opt)?.value).filter(|value| !value.is_empty());
        let mut credentials = NpmRegistry::default();
        if let Some(token) = truthy(ConfigOpt::_AuthToken) {
            credentials.token.clone_from(token);
        } else if let Some(auth) = truthy(ConfigOpt::_Auth) {
            credentials.auth.clone_from(auth);
        } else {
            credentials
                .username
                .clone_from(truthy(ConfigOpt::Username)?);
            credentials.password = decode_password(truthy(ConfigOpt::_Password)?);
        }
        Some(credentials)
    }

    /// Fills `install.url_auth`, which mirrors npm's config map: one entry per key that has a
    /// complete credential.
    fn resolve_url_auth(
        install: &mut BunInstall,
        bunfig: &BunInstall,
        configs: &[ConfigItem],
        sources: &[Source],
        log: &mut Log,
    ) {
        install.url_auth.clear();
        for ConfigItem {
            registry_url: key, ..
        } in configs
        {
            if install.url_auth.iter().any(|entry| entry.key == *key) {
                continue;
            }
            if let Some(credentials) = credentials_of_key(configs, key) {
                install.url_auth.push(NpmUrlAuth {
                    key: key.clone(),
                    credentials,
                });
            }
        }

        let mut empty = configs
            .iter()
            .filter(|item| {
                item.optname == ConfigOpt::_Auth
                    && item.value.is_empty()
                    && lookup(configs, &item.registry_url, ConfigOpt::_Auth)
                        .is_some_and(|collapsed| core::ptr::eq(collapsed, *item))
            })
            .peekable();
        if empty.peek().is_none() {
            return;
        }
        let default_url: &[u8] = match &install.default_registry {
            Some(registry) => &registry.url,
            None => b"",
        };
        let scoped = (install.scoped.iter())
            .flat_map(|scoped| scoped.scopes.values())
            .map(|registry| &*registry.url);
        // No `.npmrc` line applies to a registry that `bunfig.toml` gave credentials too.
        let from_bunfig = (bunfig.default_registry.iter())
            .chain(bunfig.scoped.iter().flat_map(|s| s.scopes.values()))
            .filter(|registry| !registry.has_credentials())
            .map(|registry| url_or_default(&registry.url));
        let registries: Vec<RegistryKey> = core::iter::once(url_or_default(default_url))
            .chain(scoped)
            .chain(from_bunfig)
            .map(RegistryKey::from_url)
            .collect();
        for item in empty {
            // Without its trailing `/` the key is a distinct one, which the walk visits right after the slashed one.
            if registries.iter().any(|registry| {
                *item.registry_url == *registry.key
                    || *item.registry_url == registry.key[..registry.key.len() - 1]
            }) {
                log.add_error_opts(
                    b"ignoring empty _auth value",
                    bun_ast::AddErrorOptions {
                        source: Some(&sources[item.source_idx as usize]),
                        loc: item.loc,
                        redact_sensitive_information: true,
                        ..Default::default()
                    },
                );
            }
        }
    }

    /// Single-file entry point (the `bun:internal-for-testing` hook).
    pub fn load_npmrc(
        install: &mut BunInstall,
        env: &DotEnvLoader,
        log: &mut Log,
        source: &Source,
    ) -> OOM<()> {
        let mut configs: Vec<ConfigItem> = Vec::new();
        parse_npmrc_into(install, env, log, source, 0, &mut configs)?;
        let sources = std::slice::from_ref(source);
        resolve_url_auth(install, &BunInstall::default(), &configs, sources, log);
        Ok(())
    }

    /// One file's options, `registry=` lines and `//host/…:<opt>=` lines (onto `configs`).
    fn parse_npmrc_into(
        install: &mut BunInstall,
        env: &DotEnvLoader,
        log: &mut Log,
        source: &Source,
        source_idx: u32,
        configs: &mut Vec<ConfigItem>,
    ) -> OOM<()> {
        let arena = Arena::new();
        let bump = &arena;
        let mut parser = Parser::init(source, env);
        parser.parse(bump)?;
        // Need to be very, very careful here with strings.
        // They are allocated in the Parser's arena, which of course gets
        // deinitialized at the end of the scope.
        // We need to dupe all strings
        let out = &parser.out;
        // Relative paths in a `.npmrc` are resolved against the directory that contains it.
        let dir = bun_core::dirname(source.path.text).unwrap_or_default();

        if let Some(query) = out.as_property(b"registry") {
            if let Some(str_) = query.expr.as_utf8_string_literal() {
                let mut registry = NpmRegistry::from_url(str_);
                registry.declared_in_npmrc = true;
                install.default_registry = Some(registry);
            }
        }

        if let Some(query) = out.as_property(b"cache") {
            if let Some(str_) = query.expr.as_utf8_string_literal() {
                install.cache_directory = Some(BunInstall::resolve_path(dir, str_));
            } else if let Some(b) = query.expr.as_bool() {
                install.disable_cache = Some(!b);
            }
        }

        if let Some(query) = out.as_property(b"dry-run") {
            if let Some(str_) = query.expr.as_utf8_string_literal() {
                install.dry_run = Some(str_ == b"true");
            } else if let Some(b) = query.expr.as_bool() {
                install.dry_run = Some(b);
            }
        }

        let ca = out.as_property(b"ca");
        let cafile = out.as_property(b"cafile");
        // `ca` and `cafile` are one setting, so a file that sets either one replaces both.
        if ca.is_some() || cafile.is_some() {
            install.ca = None;
            install.cafile = None;
        }

        if let Some(query) = ca {
            if let Some(str_) = query.expr.as_utf8_string_literal() {
                install.ca = Some(Ca::Str(Box::<[u8]>::from(str_)));
            } else if let ExprData::EArray(arr) = &query.expr.data {
                let mut list: Vec<Box<[u8]>> = Vec::with_capacity(arr.items.len_u32() as usize);
                for item in arr.items.slice() {
                    if let Some(s) = item.as_string_cloned(bump)? {
                        list.push(Box::<[u8]>::from(s));
                    }
                }
                install.ca = Some(Ca::List(list.into_boxed_slice()));
            }
        }

        if let Some(query) = cafile {
            if let Some(cafile) = query.expr.as_string_cloned(bump)? {
                install.cafile = Some(BunInstall::resolve_path(dir, cafile));
            }
        }

        for (key, save) in [(b"omit".as_slice(), false), (b"include".as_slice(), true)] {
            let Some(query) = out.as_property(key) else {
                continue;
            };
            let items = match &query.expr.data {
                ExprData::EArray(arr) => arr.items.slice(),
                _ => core::slice::from_ref(&query.expr),
            };
            for item in items {
                let ExprData::EString(str_) = &item.data else {
                    continue;
                };
                if str_.eql_comptime(b"dev") {
                    install.save_dev = Some(save);
                } else if str_.eql_comptime(b"peer") {
                    install.save_peer = Some(save);
                } else if str_.eql_comptime(b"optional") {
                    install.save_optional = Some(save);
                }
            }
        }

        for (key, option) in [
            (b"ignore-scripts".as_slice(), &mut install.ignore_scripts),
            (
                b"link-workspace-packages".as_slice(),
                &mut install.link_workspace_packages,
            ),
            (b"save-exact".as_slice(), &mut install.exact),
            (b"provenance".as_slice(), &mut install.provenance),
            (b"hoist".as_slice(), &mut install.hoist),
        ] {
            if let Some(value) = out.get(key).and_then(|expr| npmrc_bool(&expr)) {
                *option = Some(value);
            }
        }

        if let Some(install_strategy_expr) = out.get(b"install-strategy") {
            if let Some(install_strategy_str) = install_strategy_expr.as_string(bump) {
                if install_strategy_str == b"hoisted" {
                    install.node_linker = Some(NodeLinker::Hoisted);
                } else if install_strategy_str == b"linked" {
                    install.node_linker = Some(NodeLinker::Isolated);
                } else if install_strategy_str == b"nested" || install_strategy_str == b"shallow" {
                    // TODO
                }
            }
        }

        // yarn & pnpm option
        if let Some(node_linker_expr) = out.get(b"node-linker") {
            if let Some(node_linker_str) = node_linker_expr.as_string(bump) {
                if let Some(node_linker) = NODE_LINKER_MAP.get(node_linker_str) {
                    install.node_linker = Some(*node_linker);
                }
            }
        }

        for (key, pattern) in [
            (
                b"public-hoist-pattern".as_slice(),
                &mut install.public_hoist_pattern,
            ),
            (b"hoist-pattern".as_slice(), &mut install.hoist_pattern),
        ] {
            if let Some(expr) = out.get(key) {
                *pattern = match pnpm_matcher_from_expr(&expr, log, source, bump) {
                    Ok(v) => Some(v),
                    Err(FromExprError::OutOfMemory) => return Err(AllocError),
                    Err(FromExprError::UnexpectedExpr) => {
                        log.reset();
                        None
                    }
                };
            }
        }

        let mut registry_map = install.scoped.take().unwrap_or_default();

        let out_obj = parser
            .out
            .data
            .e_object()
            .expect("ini parser always yields object");
        for prop in out_obj.properties.slice() {
            let (Some(keyexpr), Some(value)) = (&prop.key, &prop.value) else {
                continue;
            };
            // A known option without a string value (`=true`, no `=`) is not a typo.
            let (Some(key), Some(value)) = (
                keyexpr.as_utf8_string_literal(),
                value.as_utf8_string_literal(),
            ) else {
                continue;
            };

            if let Some(scope) = key
                .strip_prefix(b"@")
                .and_then(|key| key.strip_suffix(b":registry"))
            {
                let mut registry = NpmRegistry::from_url(value);
                registry.declared_in_npmrc = true;
                registry_map.scopes.put(scope, registry)?;
                continue;
            }

            // `//<key>:<option>`. No option name holds a colon.
            let Some(colon) =
                bun_core::strings::last_index_of_char(key, b':').filter(|_| key.starts_with(b"//"))
            else {
                continue;
            };
            let word = &key[colon + 1..];
            let Some(optname) = core::str::from_utf8(word)
                .ok()
                .and_then(|word| word.parse::<ConfigOpt>().ok())
            else {
                // A `/` right before the colon: in `//host/:_auth:dXNl…`, the word is the
                // credential.
                if key[colon - 1] == b'/'
                    && !bun_core::strings::contains_char(word, b'/')
                    && folds_to_credential_option(word)
                {
                    // No excerpt, because the redactor doesn't recognize a secret under a
                    // misspelled name.
                    log.add_warning_fmt_no_excerpt(
                        source,
                        keyexpr.loc,
                        format_args!("ignoring unknown .npmrc option {}", bstr::BStr::new(word),),
                    );
                }
                continue;
            };
            if matches!(optname, ConfigOpt::Certfile | ConfigOpt::Keyfile) {
                // `put` stamps the key with the value's loc, so walk back over `<key>=` to the option name.
                let optname_loc = match keyexpr.loc.to_nullable() {
                    Some(loc) => Loc {
                        start: loc.start - i32::try_from(key.len() - colon).expect("int cast"),
                    },
                    None => keyexpr.loc,
                };
                bun_ast::add_warning_pretty!(
                    log,
                    Some(source),
                    optname_loc,
                    "<b>{}<r> is not supported; ignoring this .npmrc option",
                    <&'static str>::from(optname),
                );
                continue;
            }
            // Credentials are resolved later, once, over the lines of every `.npmrc`.
            configs.push(ConfigItem {
                registry_url: normalize_key(&key[2..colon]),
                optname,
                value: value.into(),
                loc: keyexpr.loc,
                source_idx,
            });
        }

        install.scoped = Some(registry_map);

        Ok(())
    }

    use bun_install_types::NodeLinker::{
        Behavior as PnpmBehavior, FromExprError, Matcher as PnpmMatcherEntry, PnpmMatcher,
        create_matcher,
    };

    /// `PnpmMatcher.fromExpr` operating on
    /// `bun_ast::Expr` instead of the lower-tier `bun_ast::Expr`.
    ///
    /// `bun_install_types` (T2) cannot depend on `bun_js_parser` (T4),
    /// and the two `ExprData` enums are distinct (closed Rust enums; only the leaf
    /// `E::*` payloads are shared). `bun_ini` depends on both, so the T4-typed
    /// overload lives here. The matcher construction is delegated to the shared
    /// `create_matcher` helper in `bun_install_types::NodeLinker`.
    fn pnpm_matcher_from_expr(
        expr: &Expr,
        log: &mut Log,
        source: &Source,
        bump: &Arena,
    ) -> Result<PnpmMatcher, FromExprError> {
        let mut matchers: Vec<PnpmMatcherEntry> = Vec::new();
        let mut has_include = false;
        let mut has_exclude = false;

        let patterns = match &expr.data {
            ExprData::EArray(patterns) => patterns.items.slice(),
            _ => core::slice::from_ref(expr),
        };
        for pattern_expr in patterns {
            let Some(pattern) = pattern_expr.as_string_cloned(bump)? else {
                log.add_error_opts(
                    b"Expected a string or an array of strings",
                    bun_ast::AddErrorOptions {
                        loc: pattern_expr.loc,
                        redact_sensitive_information: true,
                        source: Some(source),
                        ..Default::default()
                    },
                );
                return Err(FromExprError::UnexpectedExpr);
            };
            let matcher = create_matcher(pattern);
            has_include = has_include || !matcher.is_exclude;
            has_exclude = has_exclude || matcher.is_exclude;
            matchers.push(matcher);
        }

        let behavior = if !has_include {
            PnpmBehavior::AllMatchersExclude
        } else if !has_exclude {
            PnpmBehavior::AllMatchersInclude
        } else {
            PnpmBehavior::HasExcludeAndIncludeMatchers
        };

        Ok(PnpmMatcher {
            matchers: matchers.into_boxed_slice(),
            behavior,
        })
    }
} // mod draft
