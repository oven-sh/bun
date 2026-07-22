#![warn(unused_must_use)]
// ──────────────────────────────────────────────────────────────────────────
// The remaining `'static` lifetime erasures and raw-pointer borrow splits in
// this file are documented at each site; removing them is tracked by the
// bun_ini Parser lifetime-restructure work item (external arena, split `env`
// lifetime, `Source` lifetime threading in bun_ast).
// ──────────────────────────────────────────────────────────────────────────
use core::fmt;

use bun_alloc::AllocError;
use bun_ast::Loc;

type OOM<T> = Result<T, AllocError>;

// ──────────────────────────────────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────────────────────────────────

pub struct Options {
    pub bracked_array: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            bracked_array: true,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Pure-byte helpers. They touch no parser state; exposed as free fns so
// they are unit-testable without the Expr-carrying struct.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub(crate) fn should_skip_line(line: &[u8]) -> bool {
    if line.is_empty()
        // comments
        || line[0] == b';'
        || line[0] == b'#'
    {
        return true;
    }

    // check the rest is whitespace
    for &c in line {
        match c {
            b' ' | b'\t' | b'\n' | b'\r' => {}
            b'#' | b';' => return true,
            _ => return false,
        }
    }
    true
}

#[inline]
pub(crate) fn is_quoted(val: &[u8]) -> bool {
    (bun_core::starts_with_char(val, b'"') && bun_core::ends_with_char(val, b'"'))
        || (bun_core::starts_with_char(val, b'\'') && bun_core::ends_with_char(val, b'\''))
}

#[inline]
pub(crate) fn next_dot(key: &[u8]) -> Option<usize> {
    key.iter().position(|&b| b == b'.')
}

// ──────────────────────────────────────────────────────────────────────────
// IniOption — tri-state used by iterators (None != end-of-iteration)
// ──────────────────────────────────────────────────────────────────────────

pub enum IniOption<T> {
    Some(T),
    None,
}

impl<T> IniOption<T> {
    pub(crate) fn get(self) -> Option<T> {
        match self {
            IniOption::Some(v) => Some(v),
            IniOption::None => None,
        }
    }
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

impl ConfigOpt {
    pub fn is_base64_encoded(self) -> bool {
        matches!(self, ConfigOpt::_Auth | ConfigOpt::_Password)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ConfigItem
// ──────────────────────────────────────────────────────────────────────────

pub struct ConfigItem {
    /// npm's registry key: the raw text between `//` and `:<optname>=`, so
    /// `//127.0.0.1:1234/api/:_authToken=T` yields `127.0.0.1:1234/api/`. Matched
    /// literally, as npm does — `nerfDart` already lowercased the keys npm writes.
    pub registry_url: Box<[u8]>,
    pub optname: ConfigOpt,
    pub value: Box<[u8]>,
    pub loc: Loc,
    /// Index into the `.npmrc` files parsed by `load_npmrc_config`, so a
    /// diagnostic points at the file the line came from.
    pub source_idx: u32,
}

impl ConfigItem {
    /// Duplicate ConfigIterator.Item
    pub fn dupe(&self) -> OOM<Option<ConfigItem>> {
        Ok(Some(ConfigItem {
            registry_url: Box::<[u8]>::from(&*self.registry_url),
            optname: self.optname,
            value: Box::<[u8]>::from(&*self.value),
            loc: self.loc,
            source_idx: self.source_idx,
        }))
    }

    /// Duplicate the value, decoding it if it is base64 encoded. Decoding
    /// matches npm's `Buffer.from(value, "base64")`: it never fails — invalid
    /// bytes are skipped and as much data as possible is decoded.
    pub fn dupe_value_decoded(&self) -> OOM<Box<[u8]>> {
        if self.optname.is_base64_encoded() {
            let len = bun_base64::decode_lenient_len(self.value.len());
            let mut slice = vec![0u8; len].into_boxed_slice();
            let count = bun_base64::decode_lenient(&mut slice[..], &self.value, false);
            return Ok(Box::<[u8]>::from(&slice[..count]));
        }
        Ok(Box::<[u8]>::from(&*self.value))
    }

    // deinit -> Drop: Box<[u8]> fields drop automatically.
}

impl fmt::Display for ConfigItem {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            writer,
            "//{}:{}={}",
            bstr::BStr::new(&self.registry_url),
            <&'static str>::from(self.optname),
            bstr::BStr::new(&self.value),
        )
    }
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
    ConfigIterator, Parser, ScopeItem, ScopeIterator, ToStringFormatter, load_npmrc,
    load_npmrc_config,
};
pub mod config_iterator {
    pub use super::{ConfigItem as Item, ConfigIterator as Iter, ConfigOpt as Opt};
}

mod draft {

    use core::fmt;
    use core::ptr;

    use bun_alloc::{AllocError, Arena, ArenaVec, ArenaVecExt as _};
    use bun_api::{self, BunInstall, NpmRegistry, npm_registry};
    use bun_ast::E::Rope;
    use bun_ast::{E, Expr, ExprData};
    use bun_ast::{IntoStr, Loc, Log, Source};
    use bun_collections::VecExt;
    use bun_core::ZStr;
    use bun_core::{Global, Output};
    use bun_dotenv::Loader as DotEnvLoader;
    use bun_url::URL;

    use super::{
        ConfigItem, ConfigOpt, IniOption, NODE_LINKER_MAP, NodeLinker, Options, is_quoted,
        next_dot, should_skip_line,
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
        pub opts: Options,
        pub source: Source,
        pub src: &'a [u8],
        pub out: Expr,
        pub logger: Log,
        pub arena: Arena,
        pub env: &'a mut DotEnvLoader<'a>,
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
        pub fn init(path: &[u8], src: &'a [u8], env: &'a mut DotEnvLoader<'a>) -> Parser<'a> {
            // TODO: bun_ast::Source<'bump> — `Source::init_path_string`
            // currently takes `Str = &'static [u8]`; once the lower tier threads a
            // lifetime through `Source`, pass `path`/`src` directly. They outlive
            // the `Parser` and its `Source`/`Expr` tree (arena-freed in lockstep),
            // so no wrong value is produced today.
            let path_s: &'static [u8] = path.into_str();
            let src_s: &'static [u8] = src.into_str();
            Parser {
                opts: Options::default(),
                logger: Log::init(),
                src,
                out: Expr::init(E::Object::default(), Loc::EMPTY),
                source: Source::init_path_string(path_s, src_s),
                arena: Arena::new(),
                env,
            }
        }

        // deinit -> Drop: `logger` and `arena` are owned and drop automatically.

        pub fn parse(&mut self, bump: &'a Arena) -> OOM<()> {
            // borrowck — `arena_allocator` is passed separately (rather than
            // read off `self.arena`) to avoid overlapping &mut self borrows.
            let src = self.src;
            let mut iter = src.split(|&b| b == b'\n');
            // TODO: borrowck — `head` aliases into `self.out.data.e_object` while
            // `self` is also borrowed mutably for prepare_str(). Kept as raw `*mut`
            // (the underlying `E::Object` lives in the Expr Store, not on `self`).
            let mut head: *mut E::Object = std::ptr::from_mut::<E::Object>(
                self.out
                    .data
                    .e_object_mut()
                    .expect("Parser.out is E.Object"),
            );

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
                        let Some(close_bracket_idx) = line.iter().position(|&b| b == b']') else {
                            // Skip the whole line: treat_as_key stays false and
                            // we fall through to `continue` below.
                            break 'treat_as_key;
                        };
                        // Make sure the rest is just whitespace
                        if close_bracket_idx + 1 < line.len() {
                            for &c in &line[close_bracket_idx + 1..] {
                                if !matches!(c, b' ' | b'\t') {
                                    treat_as_key = true;
                                    break 'treat_as_key;
                                }
                            }
                        }
                        let offset = i32::try_from(line.as_ptr() as usize - src.as_ptr() as usize)
                            .unwrap()
                            + 1;
                        let section: &mut Rope = self
                            .prepare_str(
                                Usage::Section,
                                bump,
                                ropealloc,
                                &line[1..close_bracket_idx],
                                offset,
                            )?
                            .into_section();
                        // SAFETY: `self.out` was constructed as `E.Object` in `init()`.
                        let root = self
                            .out
                            .data
                            .e_object_mut()
                            .expect("Parser.out is E.Object");
                        let mut parent_object = match root.get_or_put_object(section, bump) {
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
                        head = std::ptr::from_mut::<E::Object>(
                            parent_object
                                .data
                                .e_object_mut()
                                .expect("get_or_put_object returns E.Object"),
                        );
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

                let maybe_eq_sign_idx = line.iter().position(|&b| b == b'=');

                let key_raw: &[u8] = self
                    .prepare_str(
                        Usage::Key,
                        bump,
                        ropealloc,
                        &line[..maybe_eq_sign_idx.unwrap_or(line.len())],
                        line_offset,
                    )?
                    .into_key();
                let is_array: bool = {
                    key_raw.len() > 2 && bun_core::strings::ends_with(key_raw, b"[]")
                    // Commenting out because options are not supported but we might
                    // support them.
                    // if (this.opts.bracked_array) {
                    //     break :brk key_raw.len > 2 and bun.strings.endsWith(key_raw, "[]");
                    // } else {
                    //     // const gop = try duplicates.getOrPut(allocator, key_raw);
                    //     // if (gop.found_existing) {
                    //     //     gop.value_ptr.* = 1;
                    //     // } else gop.value_ptr.* += 1;
                    //     // break :brk gop.value_ptr.* > 1;
                    //     @panic("We don't support this right now");
                    // }
                };

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
                            break 'brk self
                                .prepare_str(
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

                // SAFETY: head points into self.out's E::Object tree, valid for the
                // duration of parse().
                let head_ref = unsafe { &mut *head };

                if is_array {
                    if let Some(val) = head_ref.get(key) {
                        if !matches!(val.data, ExprData::EArray(_)) {
                            let mut arr = E::Array::default();
                            arr.push(bump, val)?;
                            head_ref.put(bump, key, Expr::init(arr, Loc::EMPTY))?;
                        }
                    } else {
                        head_ref.put(bump, key, Expr::init(E::Array::default(), Loc::EMPTY))?;
                    }
                }

                // safeguard against resetting a previously defined
                // array by accidentally forgetting the brackets
                let mut was_already_array = false;
                if let Some(mut val) = head_ref.get(key) {
                    if matches!(val.data, ExprData::EArray(_)) {
                        was_already_array = true;
                        val.data
                            .e_array_mut()
                            .expect("infallible: variant checked")
                            .push(bump, value)?;
                        head_ref.put(bump, key, val)?;
                    }
                }
                if !was_already_array {
                    head_ref.put(bump, key, value)?;
                }
            }
            Ok(())
        }

        fn prepare_str(
            &mut self,
            usage: Usage,
            bump: &'a Arena,
            ropealloc: &'a Arena,
            val_: &'a [u8],
            offset_: i32,
        ) -> OOM<PrepareResult<'a>> {
            let mut offset = offset_;
            let mut val = bun_core::trim(val_, b" \n\r\t");

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
                    // `Str = &'static [u8]` lifetime erasure (see PORTING.md
                    // §Allocators / `Parser::init` above). `val` is a sub-slice
                    // of `self.src` and outlives the temporary `Source`.
                    let val_s: &'static [u8] = val.into_str();
                    let src = Source::init_path_string(self.source.path.text, val_s);
                    let mut log = Log::init();
                    // Try to parse it and if it fails will just treat it as a string
                    let json_val: Expr =
                        match bun_parsers::json::parse_utf8_impl::<true>(&src, &mut log, bump) {
                            Ok(v) => v,
                            Err(_) => {
                                // JSON parse failed (e.g., single-quoted string like '${VAR}')
                                // Still need to expand env vars in the content
                                if usage == Usage::Value {
                                    let expanded = self.expand_env_vars(bump, val)?;
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
                            self.expand_env_vars(bump, str_)?
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

                                    if let Some(new_i) =
                                        self.parse_env_substitution(val, i, i, 0, &mut unesc)?
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
                            b';' | b'#' => break,
                            b'\\' => {
                                esc = true;
                                did_any_escape = true;
                            }
                            b'.' => {
                                if usage == Usage::Section && rope_parts < MAX_SECTION_ROPE_SEGMENTS
                                {
                                    self.commit_rope_part(bump, ropealloc, &mut unesc, &mut rope)?;
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
                        self.commit_rope_part(bump, ropealloc, &mut unesc, &mut rope)?;
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
        fn expand_env_vars(&mut self, bump: &'a Arena, val: &'a [u8]) -> OOM<&'a [u8]> {
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

                        if let Some(expanded) = self.env.get(env_var) {
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
            &mut self,
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
                                return self.parse_env_substitution(
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
                if let Some(expanded) = self.env.get(env_var) {
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
            &mut self,
            bump: &'a Arena,
            ropealloc: &'a Arena,
            unesc: &mut ArenaVec<'a, u8>,
            existing_rope: &mut Option<&'a mut Rope>,
        ) -> OOM<()> {
            let _ = self; // autofix
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

    pub struct ToStringFormatter<'a> {
        pub d: &'a ExprData,
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

    pub struct ConfigIterator<'a> {
        pub config: &'a E::Object,
        pub source: &'a Source,
        pub log: &'a mut Log,

        pub prop_idx: usize,
        pub source_idx: u32,
    }

    impl<'a> ConfigIterator<'a> {
        pub fn next(&mut self) -> Option<IniOption<ConfigItem>> {
            if self.prop_idx >= self.config.properties.len_u32() as usize {
                return None;
            }
            let prop_idx = self.prop_idx;
            self.prop_idx += 1;

            let prop = self.config.properties.at(prop_idx);

            if let Some(keyexpr) = prop.key {
                if let Some(key) = keyexpr.as_utf8_string_literal() {
                    if bun_core::has_prefix(key, b"//") {
                        // Order matters: `_authToken` must be
                        // matched before `_auth`.
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

                            if let Some(index) = bun_core::last_index_of(key, name_with_eq) {
                                let url_part = &key[2..index];
                                if let Some(value_expr) = prop.value {
                                    if let Some(value) = value_expr.as_utf8_string_literal() {
                                        return Some(IniOption::Some(ConfigItem {
                                            registry_url: Box::<[u8]>::from(url_part),
                                            value: Box::<[u8]>::from(value),
                                            optname: opt,
                                            loc: keyexpr.loc,
                                            source_idx: self.source_idx,
                                        }));
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Some(IniOption::None)
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ScopeIterator
    // ──────────────────────────────────────────────────────────────────────────

    pub struct ScopeIterator<'a> {
        pub config: &'a E::Object,
        pub source: &'a Source,
        pub log: &'a mut Log,

        pub prop_idx: usize,
        pub count: bool,
    }

    pub struct ScopeItem {
        pub scope: Box<[u8]>,
        pub registry: NpmRegistry,
    }

    impl<'a> ScopeIterator<'a> {
        pub fn next(&mut self) -> OOM<Option<IniOption<ScopeItem>>> {
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
                                        break 'brk parser.parse_registry_url_string_impl(str_)?;
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

    pub fn load_npmrc_config(
        install: &mut BunInstall,
        env: &mut DotEnvLoader<'_>,
        auto_loaded: bool,
        npmrc_paths: &[&ZStr],
    ) {
        let mut log = Log::init();

        // npm collapses every `.npmrc` into one flat config map before resolving
        // credentials, so all lines are accumulated and resolved once after the loop.
        // Each `Source` stays alive so a diagnostic can name the file its line is in.
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
                npmrc_path,
                &mut log,
                &sources[source_idx as usize],
                source_idx,
                &mut configs,
            ) {
                Ok(()) => {}
                Err(AllocError) => bun_core::out_of_memory(),
            }
            report_log(&mut log, npmrc_path.as_bytes());
        }

        match resolve_credentials(install, &configs, &sources, &mut log) {
            Ok(()) => {}
            Err(AllocError) => bun_core::out_of_memory(),
        }
        // The header names the file the error came from, so skip any warning ahead of it.
        let path: Box<[u8]> = log
            .msgs
            .iter()
            .find(|msg| msg.kind == bun_ast::Kind::Err)
            .and_then(|msg| msg.data.location.as_ref())
            .map_or_else(Box::default, |loc| Box::from(&*loc.file));
        report_log(&mut log, &path);
    }

    /// Print and clear `log`. Errors get a header naming the file they came from;
    /// the accumulated messages would otherwise reprint once per remaining file.
    fn report_log(log: &mut Log, npmrc_path: &[u8]) {
        if log.has_errors() {
            if log.errors == 1 {
                bun_core::warn!(
                    "Encountered an error while reading <b>{}<r>:\n\n",
                    bstr::BStr::new(npmrc_path),
                );
            } else {
                bun_core::warn!(
                    "Encountered errors while reading <b>{}<r>:\n\n",
                    bstr::BStr::new(npmrc_path),
                );
            }
            Output::flush();
        }
        let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
            Output::error_writer(),
        ));
        log.reset();
    }

    /// The single mechanism npm reads from the winning key: `_authToken`, else `_auth`,
    /// else `username` + `_password`. `certfile`/`keyfile` are absent because Bun has no
    /// mTLS, and honouring them would stop the walk on a key that supplies no credential.
    #[derive(Clone, Copy)]
    enum AuthMechanism {
        Token,
        Auth,
        UserPass,
    }

    /// Strip exactly one trailing `/`, possibly yielding an empty slice.
    /// `bun_core::without_trailing_slash` keeps a lone `/` and also strips `\`.
    fn strip_one_trailing_slash(pathname: &[u8]) -> &[u8] {
        pathname.strip_suffix(b"/").unwrap_or(pathname)
    }

    /// npm's `regKey.replace(/([^/]+|\/)$/, '')`: strip one trailing `/`, else the
    /// trailing run of non-`/` bytes.
    fn strip_one_key_component(key: &mut Vec<u8>) {
        if key.last() == Some(&b'/') {
            key.pop();
            return;
        }
        while key.last().is_some_and(|&b| b != b'/') {
            key.pop();
        }
    }

    /// The authority npm keys on: it builds the key from a WHATWG URL, whose `host` is
    /// lowercased and drops a default port. `bun_url` does neither.
    /// The port a WHATWG URL drops from `host` for this scheme.
    fn default_port_for(protocol: &[u8]) -> &'static [u8] {
        let mut protocol = protocol.to_vec();
        protocol.make_ascii_lowercase();
        match &protocol[..] {
            b"https" | b"wss" => b"443",
            b"http" | b"ws" => b"80",
            _ => b"",
        }
    }

    fn registry_key_parts(url: &URL<'_>) -> (Box<[u8]>, Box<[u8]>) {
        let default_port = default_port_for(url.protocol);
        let host = if !default_port.is_empty() && url.port == default_port {
            url.hostname
        } else {
            url.host
        };
        let mut host = host.to_vec();
        host.make_ascii_lowercase();
        (host.into_boxed_slice(), Box::from(url.pathname))
    }

    /// The key `npm config set` would have written for the same authority: lowercase, and
    /// without a default port. Paths are case-sensitive, so only the authority is touched.
    /// Used to tell a user their hand-written key applies to nothing.
    fn normalize_conf_key(key: &[u8], default_port: &[u8]) -> Box<[u8]> {
        let end = bun_core::strings::index_of_char(key, b'/').map_or(key.len(), |i| i as usize);
        let mut out = key.to_vec();
        out[..end].make_ascii_lowercase();
        if !default_port.is_empty() && end > default_port.len() + 1 {
            let colon = end - default_port.len() - 1;
            if out[colon] == b':' && out[colon + 1..end] == *default_port {
                out.drain(colon..end);
            }
        }
        out.into_boxed_slice()
    }

    /// The registry's own config key, `//<host><pathname>/`. Also npm's walk start:
    /// `regFetch` appends `/<pkg>` to the registry URL and the first iteration of the
    /// walk strips it right back off.
    fn registry_own_key(host: &[u8], pathname: &[u8]) -> Vec<u8> {
        let pathname = strip_one_trailing_slash(pathname);
        let mut key = Vec::with_capacity(host.len() + pathname.len() + 1);
        key.extend_from_slice(host);
        key.extend_from_slice(pathname);
        key.push(b'/');
        key
    }

    /// Whether `conf_key` names the registry itself: either spelling of `own_key`,
    /// with or without its trailing `/`.
    fn names_registry(own_key: &[u8], conf_key: &[u8]) -> bool {
        conf_key == own_key || conf_key == &own_key[..own_key.len() - 1]
    }

    /// npm's config is a flat map, so a key repeated across `.npmrc` files collapses
    /// to the last one read before any credential resolution happens.
    fn lookup(configs: &[ConfigItem], key: &[u8], opt: ConfigOpt) -> Option<usize> {
        configs
            .iter()
            .rposition(|conf_item| conf_item.optname == opt && *conf_item.registry_url == *key)
    }

    /// `lookup` plus npm's `opts[k]` truthiness test: an empty value supplies nothing.
    /// The emptiness test comes AFTER the collapse, so a later `username=` clears an
    /// earlier one rather than losing to it.
    fn lookup_truthy(configs: &[ConfigItem], key: &[u8], opt: ConfigOpt) -> Option<usize> {
        lookup(configs, key, opt).filter(|&i| !configs[i].value.is_empty())
    }

    /// `lookup_truthy` against the registry's own key, preferring the slashed spelling
    /// (the deeper of the two, and the one npm's walk visits first).
    fn lookup_own(configs: &[ConfigItem], own_key: &[u8], opt: ConfigOpt) -> Option<usize> {
        lookup_truthy(configs, own_key, opt)
            .or_else(|| lookup_truthy(configs, &own_key[..own_key.len() - 1], opt))
    }

    /// npm's `hasAuth`, keyed on byte equality with the config key.
    fn has_auth(configs: &[ConfigItem], key: &[u8]) -> Option<AuthMechanism> {
        if lookup_truthy(configs, key, ConfigOpt::_AuthToken).is_some() {
            return Some(AuthMechanism::Token);
        }
        if lookup_truthy(configs, key, ConfigOpt::_Auth).is_some() {
            return Some(AuthMechanism::Auth);
        }
        (lookup_truthy(configs, key, ConfigOpt::Username).is_some()
            && lookup_truthy(configs, key, ConfigOpt::_Password).is_some())
        .then_some(AuthMechanism::UserPass)
    }

    /// npm's `regFromURI`: walk the registry's config keys deepest-first until one
    /// supplies auth. For `host=h, pathname=/a/` that is `h/a/`, `h/a`, `h/`, `h`.
    fn auth_for_registry(
        configs: &[ConfigItem],
        host: &[u8],
        pathname: &[u8],
    ) -> Option<(Vec<u8>, AuthMechanism)> {
        let mut key = registry_own_key(host, pathname);
        while !key.is_empty() {
            if let Some(mechanism) = has_auth(configs, &key) {
                return Some((key, mechanism));
            }
            strip_one_key_component(&mut key);
        }
        None
    }

    /// Indices into `configs` of the lines that apply to this registry, in file order
    /// so the last write wins.
    fn credential_items(configs: &[ConfigItem], host: &[u8], pathname: &[u8]) -> Vec<usize> {
        let own_key = registry_own_key(host, pathname);
        let mut items: Vec<usize> = Vec::new();

        match auth_for_registry(configs, host, pathname) {
            Some((key, AuthMechanism::Token)) => {
                items.extend(lookup_truthy(configs, &key, ConfigOpt::_AuthToken));
            }
            Some((key, AuthMechanism::Auth)) => {
                items.extend(lookup_truthy(configs, &key, ConfigOpt::_Auth));
            }
            Some((key, AuthMechanism::UserPass)) => {
                items.extend(lookup_truthy(configs, &key, ConfigOpt::Username));
                items.extend(lookup_truthy(configs, &key, ConfigOpt::_Password));
            }
            // Bun-only second credential layer: a lone `username`/`_password` layers over
            // `bunfig.toml`'s. One key, and only the registry's own — neither an
            // ancestor nor the other spelling may supply the half this one is missing.
            None => {
                for key in [&own_key[..], &own_key[..own_key.len() - 1]] {
                    let username = lookup_truthy(configs, key, ConfigOpt::Username);
                    let password = lookup_truthy(configs, key, ConfigOpt::_Password);
                    if username.is_some() || password.is_some() {
                        items.extend(username);
                        items.extend(password);
                        break;
                    }
                }
            }
        }

        // `email` is not part of npm's auth at all, so it never walks.
        items.extend(lookup_own(configs, &own_key, ConfigOpt::Email));
        items.sort_unstable();
        items
    }

    /// Resolve every registry's credentials against the fully-accumulated `configs`,
    /// exactly once. Nothing is written twice, so nothing needs restoring.
    fn resolve_credentials(
        install: &mut BunInstall,
        configs: &[ConfigItem],
        sources: &[Source],
        log: &mut Log,
    ) -> OOM<()> {
        if configs.is_empty() {
            return Ok(());
        }

        // `URL<'a>` borrows its input; copy the parts so the borrow of
        // `install.default_registry` ends before it is mutated below.
        let (default_host, default_pathname, default_default_port): (Box<[u8]>, Box<[u8]>, &[u8]) = {
            let url_bytes: &[u8] = match &install.default_registry {
                Some(dr) => &dr.url,
                None => bun_install_types::NodeLinker::npm::Registry::DEFAULT_URL.as_bytes(),
            };
            let url = URL::parse(url_bytes);
            let (h, p) = registry_key_parts(&url);
            (h, p, default_port_for(url.protocol))
        };

        let mut registry_map = install.scoped.take().unwrap_or_default();

        // `keys()`/`values_mut()` on the same map alias, and `URL<'a>` would borrow
        // `v.url` across the mutation below; copy the URLs out first.
        let mut scope_urls: Vec<Box<[u8]>> = Vec::with_capacity(registry_map.scopes.keys().len());
        for v in registry_map.scopes.values() {
            scope_urls.push(Box::<[u8]>::from(&*v.url));
        }

        // An empty `_auth` never wins `hasAuth`, so it never reaches `apply_conf_item`.
        // Diagnose it here, where every registry is visible. npm walks past ancestor
        // keys silently, so only a line naming a registry exactly is diagnosed.
        for conf_item in configs.iter() {
            if !matches!(conf_item.optname, ConfigOpt::_Auth) || !conf_item.value.is_empty() {
                continue;
            }
            let names_a_registry = names_registry(
                &registry_own_key(&default_host, &default_pathname),
                &conf_item.registry_url,
            ) || scope_urls.iter().any(|url_bytes| {
                let (host, pathname) = registry_key_parts(&URL::parse(url_bytes));
                names_registry(&registry_own_key(&host, &pathname), &conf_item.registry_url)
            });
            if names_a_registry {
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

        // npm compares keys literally, and `nerfDart` writes them with a lowercase host and
        // no default port, so a key spelled otherwise can silently supply nothing. Warn only
        // where the line supplies nothing to ANY registry as written, but would if respelled.
        let mut registries: Vec<(Box<[u8]>, Box<[u8]>, &[u8])> =
            Vec::with_capacity(1 + scope_urls.len());
        registries.push((
            default_host.clone(),
            default_pathname.clone(),
            default_default_port,
        ));
        for url_bytes in scope_urls.iter() {
            let url = URL::parse(url_bytes);
            let (host, pathname) = registry_key_parts(&url);
            registries.push((host, pathname, default_port_for(url.protocol)));
        }

        let mut applied = vec![false; configs.len()];
        for (host, pathname, _) in registries.iter() {
            for i in credential_items(configs, host, pathname) {
                applied[i] = true;
            }
        }

        let mut dead: Vec<Option<Box<[u8]>>> = vec![None; configs.len()];
        for (host, pathname, default_port) in registries.iter() {
            let differs = |c: &ConfigItem| {
                *normalize_conf_key(&c.registry_url, default_port) != *c.registry_url
            };
            if !configs.iter().any(differs) {
                continue;
            }
            let mut normalized: Vec<ConfigItem> = Vec::with_capacity(configs.len());
            for conf_item in configs.iter() {
                let Some(mut dup) = conf_item.dupe()? else {
                    continue;
                };
                dup.registry_url = normalize_conf_key(&conf_item.registry_url, default_port);
                normalized.push(dup);
            }
            for i in credential_items(&normalized, host, pathname) {
                if !applied[i] && differs(&configs[i]) && dead[i].is_none() {
                    dead[i] = Some(core::mem::take(&mut normalized[i].registry_url));
                }
            }
        }

        for (i, conf_item) in configs.iter().enumerate() {
            let Some(respelled) = &dead[i] else {
                continue;
            };
            log.add_warning_fmt_opts_with_note(
                format_args!(
                    "the .npmrc key \"//{}\" matches no registry",
                    bstr::BStr::new(&conf_item.registry_url),
                ),
                format_args!(
                    "npm writes this key as \"//{}\"",
                    bstr::BStr::new(respelled)
                ),
                bun_ast::AddErrorOptions {
                    source: Some(&sources[conf_item.source_idx as usize]),
                    loc: conf_item.loc,
                    redact_sensitive_information: true,
                    ..Default::default()
                },
            );
        }

        let default_items = credential_items(configs, &default_host, &default_pathname);
        if !default_items.is_empty() {
            let v: &mut NpmRegistry = 'brk: {
                if let Some(r) = install.default_registry.as_mut() {
                    break 'brk r;
                }
                install.default_registry = Some(NpmRegistry {
                    password: Box::default(),
                    token: Box::default(),
                    auth: Box::default(),
                    username: Box::default(),
                    url: Box::<[u8]>::from(
                        bun_install_types::NodeLinker::npm::Registry::DEFAULT_URL.as_bytes(),
                    ),
                    email: Box::default(),
                });
                install.default_registry.as_mut().unwrap()
            };
            for &i in &default_items {
                apply_conf_item(v, &configs[i])?;
            }
        }

        for (url_bytes, v) in scope_urls.iter().zip(registry_map.scopes.values_mut()) {
            let (host, pathname) = registry_key_parts(&URL::parse(url_bytes));
            for &i in &credential_items(configs, &host, &pathname) {
                apply_conf_item(v, &configs[i])?;
            }
        }

        install.scoped = Some(registry_map);
        Ok(())
    }

    fn apply_conf_item(v: &mut NpmRegistry, conf_item: &ConfigItem) -> OOM<()> {
        match conf_item.optname {
            ConfigOpt::_AuthToken => {
                v.token = conf_item.dupe_value_decoded()?;
            }
            ConfigOpt::Username => {
                v.username = conf_item.dupe_value_decoded()?;
            }
            ConfigOpt::_Password => {
                v.password = conf_item.dupe_value_decoded()?;
            }
            ConfigOpt::_Auth => {
                // npm forwards `_auth` verbatim as `Basic <value>`; `Scope::from_api`
                // decodes it only to derive a username for `bun pm whoami`.
                if !conf_item.value.is_empty() {
                    v.auth = Box::<[u8]>::from(&*conf_item.value);
                }
            }
            ConfigOpt::Email => {
                v.email = conf_item.dupe_value_decoded()?;
            }
            ConfigOpt::Certfile | ConfigOpt::Keyfile => unreachable!(),
        }
        Ok(())
    }

    /// Single-file entry point (the `bun:internal-for-testing` hook).
    pub fn load_npmrc(
        install: &mut BunInstall,
        env: &mut DotEnvLoader<'_>,
        npmrc_path: &ZStr,
        log: &mut Log,
        source: &Source,
        configs: &mut Vec<ConfigItem>,
    ) -> OOM<()> {
        parse_npmrc_into(install, env, npmrc_path, log, source, 0, configs)?;
        resolve_credentials(install, configs, std::slice::from_ref(source), log)
    }

    /// Everything one `.npmrc` file contributes: options, `registry=` lines (last file
    /// wins by overwrite) and its `//host/…:<opt>=` lines, pushed onto `configs`.
    /// Credentials are resolved separately, once, over every file's lines.
    fn parse_npmrc_into(
        install: &mut BunInstall,
        env: &mut DotEnvLoader<'_>,
        npmrc_path: &ZStr,
        log: &mut Log,
        source: &Source,
        source_idx: u32,
        configs: &mut Vec<ConfigItem>,
    ) -> OOM<()> {
        // TODO: lifetime — `Parser<'a>` ties `src` and `env: &'a mut DotEnvLoader<'a>`
        // to a single invariant `'a`; threading that through this fn signature poisons
        // the `load_npmrc_config` loop (env borrowed-for-'a across iterations). The
        // local `parser` is dropped before this fn returns, so erase both to a fresh
        // `'p` (matches `Parser::init`'s own erasures for `path`/`src`).
        // SAFETY: `parser` does not outlive `env`/`source.contents`.
        let contents: &'static [u8] = source.contents.as_ref().into_str();
        // SAFETY: `parser` is dropped before this function returns and so does not
        // outlive `env` or its borrowed data; this cast only erases lifetimes.
        let env = unsafe {
            &mut *std::ptr::from_mut::<DotEnvLoader<'_>>(env).cast::<DotEnvLoader<'static>>()
        };
        let mut parser = Parser::init(npmrc_path.as_bytes(), contents, env);
        // TODO: borrowck — `parser.arena` is borrowed while `parser` is `&mut`.
        // TODO(refactor): restructure Parser so the bump is passed externally or split borrows.
        let bump_ptr: *const Arena = &raw const parser.arena;
        // SAFETY: arena outlives all bump-allocated slices used below.
        let bump: &Arena = unsafe { &*bump_ptr };
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
                install.default_registry =
                    Some(p.parse_registry_url_string_impl(&Box::<[u8]>::from(str_))?);
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

        if let Some(query) = out.as_property(b"ca") {
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

        if let Some(query) = out.as_property(b"cafile") {
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
            if let Some(ignore) = ignore_scripts.as_bool() {
                install.ignore_scripts = Some(ignore);
            }
        }

        if let Some(link_workspace_packages) = out.get(b"link-workspace-packages") {
            if let Some(link) = link_workspace_packages.as_bool() {
                install.link_workspace_packages = Some(link);
            }
        }

        if let Some(save_exact) = out.get(b"save-exact") {
            if let Some(exact) = save_exact.as_bool() {
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
                    Err(_) => {
                        // error.InvalidRegExp, error.UnexpectedExpr
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
                    Err(_) => {
                        // error.InvalidRegExp, error.UnexpectedExpr
                        log.reset();
                        None
                    }
                };
        }

        let mut registry_map = install.scoped.take().unwrap_or_default();

        // SAFETY: `parser.out` is an `E::Object` produced by `Parser::parse`; the
        // arena pointee lives until `parser` drops at end of fn.
        let out_obj: &E::Object = unsafe {
            &*parser
                .out
                .data
                .e_object()
                .expect("ini parser always yields object")
                .as_ptr()
        };

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

            // The single `install.scoped = registry_map` write-back happens at
            // the bottom of `load_npmrc` after the registry-configuration
            // block has finished mutating `registry_map`.
            registry_map.scopes.ensure_unused_capacity(scope_count)?;

            iter.prop_idx = 0;
            iter.count = false;

            while let Some(val) = iter.next()? {
                if let Some(result) = val.get() {
                    let registry = result.registry.dupe();
                    registry_map.scopes.put(&*result.scope, registry)?;
                }
            }
        }

        // Collect this file's `//host/…:<opt>=` lines. Credentials are resolved
        // later, once, over the lines of every `.npmrc`.
        {
            let mut iter = ConfigIterator {
                config: out_obj,
                source,
                log,
                prop_idx: 0,
                source_idx,
            };

            while let Some(val) = iter.next() {
                if let Some(conf_item_) = val.get() {
                    // `conf_item.registry_url` will look like:
                    //
                    // - localhost:4873/
                    // - somewhere-else.com/myorg/
                    //
                    // Scoped registries are set like this:
                    // - @myorg:registry=https://somewhere-else.com/myorg
                    let conf_item: &ConfigItem = &conf_item_;
                    match conf_item.optname {
                        ConfigOpt::Certfile | ConfigOpt::Keyfile => {
                            bun_ast::add_warning_pretty!(
                                iter.log,
                                Some(source),
                                iter.config
                                    .properties
                                    .at(iter.prop_idx - 1)
                                    .key
                                    .as_ref()
                                    .unwrap()
                                    .loc,
                                "The following .npmrc registry option was not applied:\n\n  <b>{}<r>\n\nBecause we currently don't support the <b>{}<r> option.",
                                conf_item,
                                <&'static str>::from(conf_item.optname),
                            );
                            continue;
                        }
                        _ => {}
                    }
                    if let Some(x) = conf_item_.dupe()? {
                        configs.push(x);
                    }
                }
            }
        }

        // An OOM `?` above leaves `install.scoped` as `None`, which is moot —
        // install aborts on OOM.
        install.scoped = Some(registry_map);

        Ok(())
    }

    use bun_install_types::NodeLinker::{
        Behavior as PnpmBehavior, CreateMatcherError, FromExprError, Matcher as PnpmMatcherEntry,
        PnpmMatcher, create_matcher,
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
        let mut buf: Vec<u8> = Vec::new();

        // bun.jsc.initialize(false) is performed lazily inside the regex vtable
        // compile hook (tier-6 owns it).

        let mut matchers: Vec<PnpmMatcherEntry> = Vec::new();
        let mut has_include = false;
        let mut has_exclude = false;

        match &expr.data {
            ExprData::EString(s) => {
                // SAFETY: arena-backed `EString::slice` mutates only its own
                // resolved-data cache; the StoreRef pointee outlives this call.
                let s_mut: &mut E::EString = unsafe { &mut *s.as_ptr() };
                let pattern = s_mut.slice(bump);
                let matcher = match create_matcher(pattern, &mut buf) {
                    Ok(m) => m,
                    Err(CreateMatcherError::OutOfMemory) => return Err(FromExprError::OutOfMemory),
                    Err(CreateMatcherError::InvalidRegExp) => {
                        log.add_error_fmt_opts(
                            format_args!("Invalid regex: {}", bstr::BStr::new(pattern)),
                            bun_ast::AddErrorOptions {
                                loc: expr.loc,
                                redact_sensitive_information: true,
                                source: Some(source),
                                ..Default::default()
                            },
                        );
                        return Err(FromExprError::InvalidRegExp);
                    }
                };
                has_include = has_include || !matcher.is_exclude;
                has_exclude = has_exclude || matcher.is_exclude;
                matchers.push(matcher);
            }
            ExprData::EArray(patterns) => {
                for pattern_expr in patterns.items.slice() {
                    if let Some(pattern) = pattern_expr.as_string_cloned(bump)? {
                        let matcher = match create_matcher(pattern, &mut buf) {
                            Ok(m) => m,
                            Err(CreateMatcherError::OutOfMemory) => {
                                return Err(FromExprError::OutOfMemory);
                            }
                            Err(CreateMatcherError::InvalidRegExp) => {
                                log.add_error_fmt_opts(
                                    format_args!("Invalid regex: {}", bstr::BStr::new(pattern)),
                                    bun_ast::AddErrorOptions {
                                        loc: pattern_expr.loc,
                                        redact_sensitive_information: true,
                                        source: Some(source),
                                        ..Default::default()
                                    },
                                );
                                return Err(FromExprError::InvalidRegExp);
                            }
                        };
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
