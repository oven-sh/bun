#![warn(unused_must_use)]
#![forbid(unsafe_code)]

use bun_ast::Loc;

// ──────────────────────────────────────────────────────────────────────────
// Pure-byte helpers. They touch no parser state; exposed as free fns so
// they are unit-testable without the Expr-carrying struct.
// ──────────────────────────────────────────────────────────────────────────

/// npm's `ini` trims keys, values and section names with `String.prototype.trim`, whose set is wider than ASCII whitespace.
pub(crate) fn trim_js_whitespace(s: &[u8]) -> &[u8] {
    trim_js_whitespace_right(trim_js_whitespace_left(s))
}

fn trim_js_whitespace_left(mut s: &[u8]) -> &[u8] {
    while let (Some(c), n) = bstr::decode_utf8(s)
        && bun_core::strings::is_js_whitespace(c as u32)
    {
        s = &s[n..];
    }
    s
}

pub(crate) fn trim_js_whitespace_right(mut s: &[u8]) -> &[u8] {
    while let (Some(c), n) = bstr::decode_last_utf8(s)
        && bun_core::strings::is_js_whitespace(c as u32)
    {
        s = &s[..s.len() - n];
    }
    s
}

#[inline]
pub(crate) fn should_skip_line(line: &[u8]) -> bool {
    let line = trim_js_whitespace(line);
    // empty or a comment
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
// IniOption — tri-state used by iterators (None != end-of-iteration)
// ──────────────────────────────────────────────────────────────────────────

pub(crate) enum IniOption<T> {
    Some(T),
    None,
    /// A `//host/...:<word>=` line whose `<word>` is not a known option.
    Unknown {
        suffix: Box<[u8]>,
        loc: bun_ast::Loc,
    },
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
    /// The text between `//` and `:<opt>=` after `normalize_key`; compared byte for byte from then on.
    pub(crate) registry_url: Box<[u8]>,
    pub(crate) optname: ConfigOpt,
    pub(crate) value: Box<[u8]>,
    pub(crate) loc: Loc,
    pub(crate) optname_loc: Loc,
    /// Which of the files `load_npmrc_config` parsed, for diagnostics.
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
};

mod draft {

    use core::fmt;
    use core::ptr;

    use bun_alloc::{AllocError, Arena, ArenaVec, ArenaVecExt as _};
    use bun_api::{self, BunInstall, NpmRegistry, NpmUrlAuth, npm_registry};
    use bun_ast::E::Rope;
    use bun_ast::{E, Expr, ExprData, StoreRef};
    use bun_ast::{Loc, Log, Source};
    use bun_collections::VecExt;
    use bun_core::ZStr;
    use bun_core::{Global, Output};
    use bun_dotenv::Loader as DotEnvLoader;
    use bun_url::URL;

    use super::{
        ConfigItem, ConfigOpt, IniOption, NODE_LINKER_MAP, NodeLinker, inline_comment_start,
        is_quoted, next_dot, should_skip_line, trim_js_whitespace, trim_js_whitespace_right,
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

    // ──────────────────────────────────────────────────────────────────────────
    // ConfigIterator
    // ──────────────────────────────────────────────────────────────────────────

    pub(crate) struct ConfigIterator<'a> {
        pub(crate) config: &'a E::Object,
        pub(crate) log: &'a mut Log,

        pub(crate) prop_idx: usize,
        pub(crate) source_idx: u32,
    }

    impl<'a> ConfigIterator<'a> {
        pub(crate) fn next(&mut self) -> Option<IniOption<ConfigItem>> {
            if self.prop_idx >= self.config.properties.len_u32() as usize {
                return None;
            }
            let prop_idx = self.prop_idx;
            self.prop_idx += 1;

            let prop = self.config.properties.at(prop_idx);

            if let Some(keyexpr) = prop.key {
                if let Some(key) = keyexpr.as_utf8_string_literal() {
                    if bun_core::has_prefix(key, b"//") {
                        const OPTNAMES: &[(&[u8], ConfigOpt)] = &[
                            (b"keyfile", ConfigOpt::Keyfile),
                            (b"certfile", ConfigOpt::Certfile),
                            (b"email", ConfigOpt::Email),
                            (b"_password", ConfigOpt::_Password),
                            (b"username", ConfigOpt::Username),
                            (b"_authToken", ConfigOpt::_AuthToken),
                            (b"_auth", ConfigOpt::_Auth),
                        ];

                        for &(name, opt) in OPTNAMES {
                            // build ":<name>"
                            let mut buf = [0u8; 16];
                            buf[0] = b':';
                            buf[1..1 + name.len()].copy_from_slice(name);
                            let name_with_eq = &buf[..1 + name.len()];

                            if let Some(index) = bun_core::last_index_of(key, name_with_eq)
                                .filter(|&index| index + name_with_eq.len() == key.len())
                            {
                                let url_part = &key[2..index];
                                if let Some(value_expr) = prop.value {
                                    if let Some(value) = value_expr.as_utf8_string_literal() {
                                        // `put` stamps the key with the value's loc, so walk back over `<key>=` to the option name.
                                        let optname_loc = match keyexpr.loc.to_nullable() {
                                            Some(loc) => Loc {
                                                start: loc.start
                                                    - i32::try_from(key.len() - index)
                                                        .expect("int cast"),
                                            },
                                            None => keyexpr.loc,
                                        };
                                        return Some(IniOption::Some(ConfigItem {
                                            registry_url: normalize_key(url_part),
                                            value: Box::<[u8]>::from(value),
                                            optname: opt,
                                            loc: keyexpr.loc,
                                            optname_loc,
                                            source_idx: self.source_idx,
                                        }));
                                    }
                                }
                                // A known option without a string value (`=true`, no `=`) is not a typo.
                                return Some(IniOption::None);
                            }
                        }
                        // Only a misspelt credential option warns; `always-auth`, `tokenHelper`, `cafile` are ignored as in npm.
                        // No second colon after the key's last `/`: `//host/:_auth:dXNl…` would name the credential as the option.
                        if let Some(colon) = bun_core::strings::last_index_of_char(key, b':')
                            .filter(|&colon| !bun_core::strings::contains_char(&key[colon..], b'/'))
                            .filter(|&colon| colon > 0 && key[colon - 1] == b'/')
                        {
                            let word = &key[colon + 1..];
                            let has_string_value = prop
                                .value
                                .is_some_and(|value| value.as_utf8_string_literal().is_some());
                            if has_string_value && folds_to_credential_option(word) {
                                return Some(IniOption::Unknown {
                                    suffix: Box::from(word),
                                    loc: keyexpr.loc,
                                });
                            }
                        }
                    }
                }
            }

            Some(IniOption::None)
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

    /// npm's `nerfDart`: no scheme, a lowercase host. A port stays as written, except the default port of a scheme
    /// that is spelled out (`//http://host:80/:_authToken=`, the form Bun's docs long showed).
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
    // ScopeIterator
    // ──────────────────────────────────────────────────────────────────────────

    pub(crate) struct ScopeIterator<'a> {
        pub(crate) config: &'a E::Object,
        pub(crate) source: &'a Source,
        pub(crate) log: &'a mut Log,

        pub(crate) prop_idx: usize,
        pub(crate) count: bool,
    }

    pub(crate) struct ScopeItem {
        pub(crate) scope: Box<[u8]>,
        pub(crate) registry: NpmRegistry,
    }

    impl<'a> ScopeIterator<'a> {
        pub(crate) fn next(&mut self) -> OOM<Option<IniOption<ScopeItem>>> {
            if self.prop_idx >= self.config.properties.len_u32() as usize {
                return Ok(None);
            }
            let prop_idx = self.prop_idx;
            self.prop_idx += 1;

            let prop = self.config.properties.at(prop_idx);

            if let Some(keyexpr) = prop.key {
                if let Some(key) = keyexpr.as_utf8_string_literal() {
                    if bun_core::has_prefix(key, b"@")
                        && bun_core::strings::ends_with(key, b":registry")
                    {
                        if !self.count {
                            let registry = 'brk: {
                                if let Some(value) = prop.value {
                                    if let Some(str_) = value.as_utf8_string_literal() {
                                        let mut parser = npm_registry::Parser {
                                            log: &mut *self.log,
                                            source: self.source,
                                        };
                                        let mut registry =
                                            parser.parse_registry_url_string_impl(str_)?;
                                        registry.declared_in_npmrc = true;
                                        break 'brk registry;
                                    }
                                }
                                return Ok(Some(IniOption::None));
                            };
                            return Ok(Some(IniOption::Some(ScopeItem {
                                scope: Box::<[u8]>::from(&key[1..key.len() - b":registry".len()]),
                                registry,
                            })));
                        }
                    }
                }
            }

            Ok(Some(IniOption::None))
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // loadNpmrcConfig / loadNpmrc
    // ──────────────────────────────────────────────────────────────────────────

    /// npm's Boolean coercion (`@npmcli/config` parse-field, then nopt `validateBoolean`): `false`, `null`, `undefined` and a
    /// numeric zero are false, everything else is true, an empty value included.
    fn npmrc_bool(expr: &Expr) -> Option<bool> {
        match &expr.data {
            ExprData::EBoolean(b) => Some(b.value),
            ExprData::ENull(_) => Some(false),
            // ini JSON-parses a single-quoted value: `'1'` is a number, `'{}'` an object
            ExprData::ENumber(_) => expr.as_number().map(|n| n != 0.0),
            ExprData::EObject(_) => Some(true),
            ExprData::EString(_) => Some(npm_config_bool(expr.as_utf8_string_literal()?)),
            _ => None,
        }
    }

    /// [`npmrc_bool`] of a string, which is all that `npm_config_<key>` in the environment can hold
    /// (npm skips a variable with an empty value).
    pub fn npm_config_bool(value: &[u8]) -> bool {
        let value = trim_js_whitespace(value);
        if value.is_empty() {
            return true;
        }
        if matches!(value, b"false" | b"null" | b"undefined") {
            return false;
        }
        // nopt: a numeric string is `!!Number(value)`, any other string is true
        bun_ast::expr::string_to_equivalent_number_value(value) != 0.0
    }

    /// Where the warnings and errors of a `.npmrc` go.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum NpmrcDiagnostics {
        Print,
        /// Runtime auto-install: the stderr is the script's.
        Discard,
    }

    /// Reads every `.npmrc` into `install`; `bunfig` only tells the diagnostics which registries exist.
    pub fn load_npmrc_config(
        install: &mut BunInstall,
        bunfig: &BunInstall,
        env: &DotEnvLoader,
        auto_loaded: bool,
        diagnostics: NpmrcDiagnostics,
        npmrc_paths: &[&ZStr],
    ) {
        let mut log = Log::init();
        let mut configs: Vec<ConfigItem> = Vec::new();
        let mut sources: Vec<Source> = Vec::new();

        for &npmrc_path in npmrc_paths {
            let source = match bun_ast::source_from_file(
                npmrc_path,
                bun_ast::ToSourceOptions { convert_bom: true },
            ) {
                Ok(s) => s,
                Err(err) => {
                    if auto_loaded {
                        if diagnostics == NpmrcDiagnostics::Print
                            && log.level.at_least(bun_ast::Level::Warn)
                            && err.is_unreadable_file(npmrc_path.as_bytes())
                        {
                            bun_core::warn!(
                                "{}\nThe registry and auth settings in <b>{}<r> are not applied.",
                                err,
                                bstr::BStr::new(npmrc_path.as_bytes()),
                            );
                        }
                        continue;
                    }
                    Output::err(
                        err,
                        "failed to read .npmrc: \"{s}\"",
                        (bstr::BStr::new(npmrc_path.as_bytes()),),
                    );
                    Global::crash();
                }
            };

            let source_idx = sources.len() as u32;
            sources.push(source);

            match parse_npmrc_into(
                install,
                env,
                &mut log,
                &sources[source_idx as usize],
                source_idx,
                &mut configs,
            ) {
                Ok(()) => {}
                Err(AllocError) => bun_core::out_of_memory(),
            }
            report_log(&mut log, diagnostics);
        }

        install.url_auth = collapse_url_auth(&configs);
        if !configs.is_empty() && diagnostics == NpmrcDiagnostics::Print {
            let registries = declared_registry_keys(install, bunfig);
            diagnose_config(&configs, &sources, &registries, &mut log);
        }
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
            if log.errors == 1 {
                bun_core::warn!(
                    "Encountered an error while reading <b>{}<r>:\n\n",
                    bstr::BStr::new(path),
                );
            } else {
                bun_core::warn!(
                    "Encountered errors while reading <b>{}<r>:\n\n",
                    bstr::BStr::new(path),
                );
            }
            Output::flush();
        }
        let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
            Output::error_writer(),
        ));
        log.reset();
    }

    /// npm's `regKey.replace(/([^/]+|\/)$/, '')`, as the length that is left.
    fn strip_one_key_component(key: &[u8]) -> usize {
        let mut end = key.len();
        if key.last() == Some(&b'/') {
            return end - 1;
        }
        while end > 0 && key[end - 1] != b'/' {
            end -= 1;
        }
        end
    }

    fn url_or_default(url: &[u8]) -> &[u8] {
        if url.is_empty() {
            bun_install_types::NodeLinker::npm::Registry::DEFAULT_URL.as_bytes()
        } else {
            url
        }
    }

    /// A URL as npm's key walk sees it: the WHATWG serialisation `Scope::set_url` stores (so the key and the request
    /// agree on the authority) without scheme and query. A URL WHATWG rejects (`$VAR`) falls back to the raw text.
    pub struct RegistryKey {
        /// `<host><path>/`: npm's key for the registry itself, and where the walk starts.
        key: Box<[u8]>,
        /// `key` with the default port of the URL's scheme written out: `//host:443/` lines matched before the walk.
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
            // `pathname` carries the query; `path` is query-free but collapses a one-byte path such as `/r/` to `/`.
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

        /// npm's `regFromURI`: this key, then one component shorter each time, down to the bare host.
        /// For `https://h/a/` that is `h/a/`, `h:443/a/`, `h/a`, `h:443/a`, `h/`, `h:443/`, `h`, `h:443`.
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
                let shorter = strip_one_key_component(current);
                next = (shorter > 0).then_some(shorter);
                Some(current)
            })
        }

        /// `None` when `bunfig.toml` gave the registry credentials too: no `.npmrc` line applies to it then.
        fn for_bunfig(registry: &NpmRegistry) -> Option<RegistryKey> {
            (!registry.has_credentials())
                .then(|| RegistryKey::from_url(url_or_default(&registry.url)))
        }

        /// Without the trailing `/`: a distinct key, which the walk visits right after the slashed one.
        fn unslashed(&self) -> &[u8] {
            &self.key[..self.key.len() - 1]
        }
    }

    /// npm's config is a flat map: a key repeated across `.npmrc` files collapses to the last one read.
    fn lookup<'a>(configs: &'a [ConfigItem], key: &[u8], opt: ConfigOpt) -> Option<&'a ConfigItem> {
        configs
            .iter()
            .rfind(|conf_item| conf_item.optname == opt && *conf_item.registry_url == *key)
    }

    /// `lookup` plus npm's `opts[k]` truthiness test, after the collapse: a later `username=` clears an earlier one.
    fn lookup_truthy<'a>(
        configs: &'a [ConfigItem],
        key: &[u8],
        opt: ConfigOpt,
    ) -> Option<&'a ConfigItem> {
        lookup(configs, key, opt).filter(|conf_item| !conf_item.value.is_empty())
    }

    /// What one config key supplies, in npm's order. No `certfile` / `keyfile`: Bun has no mTLS, and they would stop
    /// the walk on a key that supplies no credential.
    enum Auth<'a> {
        Token(&'a ConfigItem),
        Basic(&'a ConfigItem),
        UserPass {
            username: &'a ConfigItem,
            password: &'a ConfigItem,
        },
    }

    /// npm's `hasAuth`, keyed on byte equality with the config key.
    fn has_auth<'a>(configs: &'a [ConfigItem], key: &[u8]) -> Option<Auth<'a>> {
        if let Some(token) = lookup_truthy(configs, key, ConfigOpt::_AuthToken) {
            return Some(Auth::Token(token));
        }
        if let Some(auth) = lookup_truthy(configs, key, ConfigOpt::_Auth) {
            return Some(Auth::Basic(auth));
        }
        let username = lookup_truthy(configs, key, ConfigOpt::Username)?;
        let password = lookup_truthy(configs, key, ConfigOpt::_Password)?;
        Some(Auth::UserPass { username, password })
    }

    /// npm's `Buffer.from(value, "base64")`, which skips invalid bytes and never fails.
    fn decode_password(value: &[u8]) -> Box<[u8]> {
        // Among the bytes it would skip are the CR, LF and NUL that `Scope::from_api` refuses: left for it to see.
        if bun_core::strings::contains_any(value, b"\r\n\0") {
            return value.into();
        }
        let mut decoded = vec![0u8; bun_base64::decode_lenient_len(value.len())];
        let count = bun_base64::decode_lenient(&mut decoded[..], value, false);
        decoded.truncate(count);
        decoded.into_boxed_slice()
    }

    /// What one config key supplies, in the shape `Scope::from_api` consumes.
    fn apply_auth(auth: &Auth<'_>, v: &mut NpmRegistry) {
        match auth {
            Auth::Token(token) => v.token.clone_from(&token.value),
            // Verbatim, as npm sends it.
            Auth::Basic(auth) => v.auth.clone_from(&auth.value),
            Auth::UserPass { username, password } => {
                v.username.clone_from(&username.value);
                v.password = decode_password(&password.value);
            }
        }
    }

    /// npm's config map, reduced to one entry per key that carries a complete credential.
    fn collapse_url_auth(configs: &[ConfigItem]) -> Vec<NpmUrlAuth> {
        let mut out: Vec<NpmUrlAuth> = Vec::new();
        for conf_item in configs {
            if out
                .iter()
                .any(|entry| *entry.key == *conf_item.registry_url)
            {
                continue;
            }
            let Some(auth) = has_auth(configs, &conf_item.registry_url) else {
                continue;
            };
            let mut credentials = NpmRegistry::default();
            apply_auth(&auth, &mut credentials);
            out.push(NpmUrlAuth {
                key: conf_item.registry_url.clone(),
                credentials,
            });
        }
        out
    }

    /// The keys of the registries `.npmrc` and `bunfig.toml` declare, or of npm's default.
    fn declared_registry_keys(install: &BunInstall, bunfig: &BunInstall) -> Vec<RegistryKey> {
        let default_url: &[u8] = match &install.default_registry {
            Some(registry) => &registry.url,
            None => b"",
        };
        let mut registries = vec![RegistryKey::from_url(url_or_default(default_url))];
        if let Some(scoped) = &install.scoped {
            registries.extend(
                scoped
                    .scopes
                    .values()
                    .iter()
                    .map(|v| RegistryKey::from_url(&v.url)),
            );
        }
        for registry in bunfig
            .default_registry
            .iter()
            .chain(bunfig.scoped.iter().flat_map(|s| s.scopes.values()))
        {
            registries.extend(RegistryKey::for_bunfig(registry));
        }
        registries
    }

    /// An empty `_auth` on a registry's own key is an error, reported once, at the line the key collapsed to.
    fn diagnose_config(
        configs: &[ConfigItem],
        sources: &[Source],
        registries: &[RegistryKey],
        log: &mut Log,
    ) {
        for conf_item in configs.iter() {
            if conf_item.optname != ConfigOpt::_Auth
                || !conf_item.value.is_empty()
                || !lookup(configs, &conf_item.registry_url, ConfigOpt::_Auth)
                    .is_some_and(|collapsed| core::ptr::eq(collapsed, conf_item))
            {
                continue;
            }
            if registries.iter().any(|registry| {
                *conf_item.registry_url == *registry.key
                    || *conf_item.registry_url == *registry.unslashed()
            }) {
                log.add_error_opts(
                    b"empty _auth value: this line supplies no credentials",
                    bun_ast::AddErrorOptions {
                        source: Some(&sources[conf_item.source_idx as usize]),
                        loc: conf_item.loc,
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
        install.url_auth = collapse_url_auth(&configs);
        if !configs.is_empty() {
            let registries = declared_registry_keys(install, &BunInstall::default());
            diagnose_config(&configs, std::slice::from_ref(source), &registries, log);
        }
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

        if let Some(query) = out.as_property(b"registry") {
            if let Some(str_) = query.expr.as_utf8_string_literal() {
                let mut p = bun_api::npm_registry::Parser {
                    log: &mut *log,
                    source,
                };
                let mut registry = p.parse_registry_url_string_impl(&Box::<[u8]>::from(str_))?;
                registry.declared_in_npmrc = true;
                install.default_registry = Some(registry);
            }
        }

        if let Some(query) = out.as_property(b"cache") {
            if let Some(str_) = query.expr.as_utf8_string_literal() {
                install.cache_directory = Some(Box::<[u8]>::from(str_));
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
        // `ca` + `cafile` are one setting: a file that sets either replaces both.
        if ca.is_some() || cafile.is_some() {
            install.ca = None;
            install.cafile = None;
        }

        if let Some(query) = ca {
            if let Some(str_) = query.expr.as_utf8_string_literal() {
                install.ca = Some(bun_api::Ca::Str(Box::<[u8]>::from(str_)));
            } else if let ExprData::EArray(arr) = &query.expr.data {
                let mut list: Vec<Box<[u8]>> = Vec::with_capacity(arr.items.len_u32() as usize);
                for item in arr.items.slice() {
                    if let Some(s) = item.as_string_cloned(bump)? {
                        list.push(Box::<[u8]>::from(s));
                    }
                }
                install.ca = Some(bun_api::Ca::List(list.into_boxed_slice()));
            }
        }

        if let Some(query) = cafile {
            if let Some(cafile) = query.expr.as_string_cloned(bump)? {
                install.cafile = Some(Box::<[u8]>::from(cafile));
            }
        }

        if let Some(omit) = out.as_property(b"omit") {
            match &omit.expr.data {
                ExprData::EString(str_) => {
                    if str_.eql_comptime(b"dev") {
                        install.save_dev = Some(false);
                    } else if str_.eql_comptime(b"peer") {
                        install.save_peer = Some(false);
                    } else if str_.eql_comptime(b"optional") {
                        install.save_optional = Some(false);
                    }
                }
                ExprData::EArray(arr) => {
                    for item in arr.items.slice() {
                        if let ExprData::EString(str_) = &item.data {
                            if str_.eql_comptime(b"dev") {
                                install.save_dev = Some(false);
                            } else if str_.eql_comptime(b"peer") {
                                install.save_peer = Some(false);
                            } else if str_.eql_comptime(b"optional") {
                                install.save_optional = Some(false);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if let Some(omit) = out.as_property(b"include") {
            match &omit.expr.data {
                ExprData::EString(str_) => {
                    if str_.eql_comptime(b"dev") {
                        install.save_dev = Some(true);
                    } else if str_.eql_comptime(b"peer") {
                        install.save_peer = Some(true);
                    } else if str_.eql_comptime(b"optional") {
                        install.save_optional = Some(true);
                    }
                }
                ExprData::EArray(arr) => {
                    for item in arr.items.slice() {
                        if let ExprData::EString(str_) = &item.data {
                            if str_.eql_comptime(b"dev") {
                                install.save_dev = Some(true);
                            } else if str_.eql_comptime(b"peer") {
                                install.save_peer = Some(true);
                            } else if str_.eql_comptime(b"optional") {
                                install.save_optional = Some(true);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if let Some(ignore_scripts) = out.get(b"ignore-scripts") {
            if let Some(ignore) = npmrc_bool(&ignore_scripts) {
                install.ignore_scripts = Some(ignore);
            }
        }

        if let Some(link_workspace_packages) = out.get(b"link-workspace-packages") {
            if let Some(link) = npmrc_bool(&link_workspace_packages) {
                install.link_workspace_packages = Some(link);
            }
        }

        if let Some(save_exact) = out.get(b"save-exact") {
            if let Some(exact) = npmrc_bool(&save_exact) {
                install.exact = Some(exact);
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

        if let Some(public_hoist_pattern_expr) = out.get(b"public-hoist-pattern") {
            install.public_hoist_pattern =
                match pnpm_matcher_from_expr(&public_hoist_pattern_expr, log, source, bump) {
                    Ok(v) => Some(v),
                    Err(FromExprError::OutOfMemory) => return Err(AllocError),
                    Err(FromExprError::UnexpectedExpr) => {
                        log.reset();
                        None
                    }
                };
        }

        if let Some(hoist_pattern_expr) = out.get(b"hoist-pattern") {
            install.hoist_pattern =
                match pnpm_matcher_from_expr(&hoist_pattern_expr, log, source, bump) {
                    Ok(v) => Some(v),
                    Err(FromExprError::OutOfMemory) => return Err(AllocError),
                    Err(FromExprError::UnexpectedExpr) => {
                        log.reset();
                        None
                    }
                };
        }

        if let Some(hoist_expr) = out.get(b"hoist") {
            if let Some(hoist) = npmrc_bool(&hoist_expr) {
                install.hoist = Some(hoist);
            }
        }

        let mut registry_map = install.scoped.take().unwrap_or_default();

        let out_ref = parser
            .out
            .data
            .e_object()
            .expect("ini parser always yields object");
        let out_obj: &E::Object = &out_ref;

        // Process scopes
        {
            let mut iter = ScopeIterator {
                config: out_obj,
                count: true,
                source,
                log,
                prop_idx: 0,
            };

            let scope_count = {
                let mut count: usize = 0;
                while let Some(o) = iter.next()? {
                    if matches!(o, IniOption::Some(_)) {
                        count += 1;
                    }
                }
                count
            };

            registry_map.scopes.ensure_unused_capacity(scope_count)?;

            iter.prop_idx = 0;
            iter.count = false;

            while let Some(val) = iter.next()? {
                if let IniOption::Some(result) = val {
                    let registry = result.registry.clone();
                    registry_map.scopes.put(&*result.scope, registry)?;
                }
            }
        }

        // Credentials are resolved later, once, over the lines of every `.npmrc`.
        {
            let mut iter = ConfigIterator {
                config: out_obj,
                log,
                prop_idx: 0,
                source_idx,
            };

            while let Some(val) = iter.next() {
                let conf_item = match val {
                    IniOption::Some(conf_item) => conf_item,
                    IniOption::None => continue,
                    IniOption::Unknown { suffix, loc } => {
                        // No excerpt: the redactor does not recognise a secret under a misspelt name.
                        iter.log.add_warning_fmt_no_excerpt(
                            source,
                            loc,
                            format_args!(
                                "{} is not a known .npmrc option; ignoring this line",
                                bstr::BStr::new(&suffix),
                            ),
                        );
                        continue;
                    }
                };
                if matches!(conf_item.optname, ConfigOpt::Certfile | ConfigOpt::Keyfile) {
                    bun_ast::add_warning_pretty!(
                        iter.log,
                        Some(source),
                        conf_item.optname_loc,
                        "<b>{}<r> is not supported; ignoring this .npmrc option",
                        <&'static str>::from(conf_item.optname),
                    );
                    continue;
                }
                configs.push(conf_item);
            }
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

        match &expr.data {
            ExprData::EString(s) => {
                let mut s = *s;
                let matcher = create_matcher(s.slice(bump));
                has_include = has_include || !matcher.is_exclude;
                has_exclude = has_exclude || matcher.is_exclude;
                matchers.push(matcher);
            }
            ExprData::EArray(patterns) => {
                for pattern_expr in patterns.items.slice() {
                    if let Some(pattern) = pattern_expr.as_string_cloned(bump)? {
                        let matcher = create_matcher(pattern);
                        has_include = has_include || !matcher.is_exclude;
                        has_exclude = has_exclude || matcher.is_exclude;
                        matchers.push(matcher);
                    } else {
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
                    }
                }
            }
            _ => {
                log.add_error_opts(
                    b"Expected a string or an array of strings",
                    bun_ast::AddErrorOptions {
                        loc: expr.loc,
                        redact_sensitive_information: true,
                        source: Some(source),
                        ..Default::default()
                    },
                );
                return Err(FromExprError::UnexpectedExpr);
            }
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
