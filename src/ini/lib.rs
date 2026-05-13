#![feature(allocator_api)]
#![allow(unused, dead_code, non_snake_case, non_upper_case_globals)]
#![warn(unused_must_use)]
// ──────────────────────────────────────────────────────────────────────────
// Phase B-2 un-gate: pieces that do not transitively need the JS-AST
// (`Expr`/`E::Object`/`Rope`) or the schema (`BunInstall`/`NpmRegistry`)
// now compile for real. Everything that touches those types stays re-gated
// with a `// TODO(b2-blocked):` pointing at the missing lower-tier symbol.
// ──────────────────────────────────────────────────────────────────────────
#![warn(unreachable_pub)]
use bun_collections::VecExt;
use core::fmt;

use bun_alloc::{AllocError, Arena, ArenaVec, ArenaVecExt as _};
use bun_ast::{Loc, Log, Source};
use bun_core::ZStr;

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
// Pure-byte helpers (lifted from `Parser` so they compile without the
// Expr-carrying struct). The Zig has these as methods on `Parser` but they
// touch no parser state — exposing them as free fns lets the logic stay
// un-gated and unit-testable while the AST-dependent body is blocked.
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
    pub fn get(self) -> Option<T> {
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
    /// `${username}:${password}` encoded in base64
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
    pub registry_url: Box<[u8]>,
    pub optname: ConfigOpt,
    pub value: Box<[u8]>,
    pub loc: Loc,
}

impl ConfigItem {
    /// Duplicate ConfigIterator.Item
    pub fn dupe(&self) -> OOM<Option<ConfigItem>> {
        Ok(Some(ConfigItem {
            registry_url: Box::<[u8]>::from(&*self.registry_url),
            optname: self.optname,
            value: Box::<[u8]>::from(&*self.value),
            loc: self.loc,
        }))
    }

    /// Duplicate the value, decoding it if it is base64 encoded.
    pub fn dupe_value_decoded(&self, log: &mut Log, source: &Source) -> OOM<Option<Box<[u8]>>> {
        if self.optname.is_base64_encoded() {
            if self.value.is_empty() {
                return Ok(Some(Box::default()));
            }
            let len = bun_base64::decode_len(&self.value);
            let mut slice = vec![0u8; len].into_boxed_slice();
            let result = bun_base64::decode(&mut slice[..], &self.value);
            if !result.is_successful() {
                log.add_error_fmt_opts(
                    format_args!("{} is not valid base64", <&'static str>::from(self.optname)),
                    bun_ast::AddErrorOptions {
                        source: Some(source),
                        loc: self.loc,
                        ..Default::default()
                    },
                );
                return Ok(None);
            }
            return Ok(Some(Box::<[u8]>::from(&slice[..result.count])));
        }
        Ok(Some(Box::<[u8]>::from(&*self.value)))
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

static NODE_LINKER_MAP: phf::Map<&'static [u8], NodeLinker> = phf::phf_map! {
    // yarn
    b"pnpm" => NodeLinker::Isolated,
    b"node-modules" => NodeLinker::Hoisted,
    // pnpm
    b"isolated" => NodeLinker::Isolated,
    b"hoisted" => NodeLinker::Hoisted,
};

// ──────────────────────────────────────────────────────────────────────────
// ScopeError
// ──────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ScopeError {
    #[error("no_value")]
    NoValue,
}

// ──────────────────────────────────────────────────────────────────────────
// Re-gated items + shadow stubs
//
// `Parser::parse` / `Parser::prepare_str` (unquoted path) / `ConfigIterator`
// now compile against the live `bun_js_parser::{Expr, ExprData, E::*}` surface.
// Remaining gates are blocked on schema/API types only:
// ──────────────────────────────────────────────────────────────────────────

// TODO(b2-blocked): bun_api::BunInstall
// TODO(b2-blocked): bun_api::NpmRegistry
// TODO(b2-blocked): bun_api::NpmRegistryMap
// TODO(b2-blocked): bun_api::npm_registry::Parser
// TODO(b2-blocked): bun_api::Ca
// TODO(b2-blocked): bun_install_types::NodeLinker::PnpmMatcher::from_expr

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
    use std::io::Write as _;

    use bun_alloc::{AllocError, Arena, ArenaVec, ArenaVecExt as _};
    use bun_api::{self, BunInstall, Ca, NpmRegistry, NpmRegistryMap, npm_registry};
    use bun_ast::E::Rope;
    use bun_ast::{self as js_ast, E, Expr, ExprData};
    use bun_ast::{IntoStr, Loc, Log, Source};
    use bun_collections::{ArrayHashMap, VecExt};
    use bun_core::ZStr;
    use bun_core::{Global, Output};
    use bun_dotenv::Loader as DotEnvLoader;
    use bun_url::URL;

    use super::{
        ConfigItem, ConfigOpt, IniOption, NODE_LINKER_MAP, NodeLinker, Options, ScopeError,
        is_quoted, next_dot, should_skip_line,
    };

    type OOM<T> = Result<T, AllocError>;

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

    // PORT NOTE: Zig `prepareStr` switches its *return type* on a comptime enum
    // param (`.section -> *Rope`, `.key -> []const u8`, `.value -> Expr`). Rust
    // const generics cannot select a return type, so we keep a single
    // `prepare_str::<USAGE>()` body for diffability and wrap the result in
    // `PrepareResult`. Callers unwrap with `.into_*()`.
    //
    // PORT NOTE: `#[derive(ConstParamTy)]` requires nightly `adt_const_params`.
    // Dropped to a runtime arg (the body never uses USAGE in a type position).
    // PERF(port): was comptime monomorphization — profile in Phase B.
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
            // TODO(b2-blocked): bun_ast::Source<'bump> — `Source::init_path_string`
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
            // TODO(port): borrowck — in Zig, `arena_allocator` is `self.arena.arena()`;
            // here it is passed separately to avoid overlapping &mut self borrows.
            let src = self.src;
            let mut iter = src.split(|&b| b == b'\n');
            // TODO(port): borrowck — `head` aliases into `self.out.data.e_object` while
            // `self` is also borrowed mutably for prepare_str(). Kept as raw `*mut`
            // (the underlying `E::Object` lives in the Expr Store, not on `self`).
            let mut head: *mut E::Object = std::ptr::from_mut::<E::Object>(
                self.out
                    .data
                    .e_object_mut()
                    .expect("Parser.out is E.Object"),
            );

            // var duplicates = bun.StringArrayHashMapUnmanaged(u32){};
            // defer duplicates.deinit(allocator);

            // PERF(port): was stack-fallback (sizeOf(Rope)*6) over arena — using bump directly.
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
                            // Zig: `orelse continue` — skip the whole line
                            break 'treat_as_key;
                            // PORT NOTE: reshaped — Zig `continue` from inside labeled block;
                            // we set treat_as_key=false and fall through to `continue` below.
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
                        // PERF(port): was `rope_stack.fixed_buffer_allocator.reset()` here.
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
                    key_raw.len() > 2 && bun_core::ends_with(key_raw, b"[]")
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

                let key = if is_array && bun_core::ends_with(key_raw, b"[]") {
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
            val_: &[u8],
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
                    // `bun_parsers::json::parse_utf8_impl` returns the T2
                    // value-subset `bun_ast::Expr`; lift it into the T4
                    // `bun_ast::Expr` (via the `From` impl in
                    // `bun_ast::expr`) so the rest of this body works
                    // against a single `ExprData`.
                    // Phase-A `Str = &'static [u8]` lifetime erasure (see
                    // PORTING.md §Allocators / `Parser::init` above). `val` is a
                    // sub-slice of `self.src` and outlives the temporary `Source`.
                    let val_s: &'static [u8] = val.into_str();
                    let src = Source::init_path_string(self.source.path.text, val_s);
                    let mut log = Log::init();
                    // Try to parse it and if it fails will just treat it as a string
                    let json_val: Expr =
                        match bun_parsers::json::parse_utf8_impl::<true>(&src, &mut log, bump) {
                            Ok(v) => Expr::from(v),
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
                        // Spec ini.zig:247: `if (comptime usage == .value) return json_val;`
                        // — the parsed Expr is returned as-is, preserving
                        // `E.Array`/`E.Object` tags so downstream `.e_array`/
                        // `.e_object` checks (e.g. ini.zig:178/192, loadNpmrc
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
                            // PERF(port): was std.fmt.allocPrint into arena. Cold
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
                // PERF(port): was stack-fallback(STACK_BUF_SIZE) over arena
                let mut unesc = ArenaVec::<u8>::with_capacity_in(STACK_BUF_SIZE, bump);

                // RopeT is *Rope when usage==Section, else unit. In Rust we just
                // keep an Option<&mut Rope> and ignore it for non-section usages.
                let mut rope: Option<&'a mut Rope> = None;

                let mut i: usize = 0;
                'walk: while i < val.len() {
                    let c = val[i];
                    if esc {
                        match c {
                            b'\\' => unesc.extend_from_slice(&[b'\\']),
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
                                if usage == Usage::Section {
                                    self.commit_rope_part(bump, ropealloc, &mut unesc, &mut rope)?;
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
                // TODO(port): lifetime — `val` borrows `val_` (caller line slice);
                // Zig returns it directly. Dupe into the bump for now.
                return Ok(PrepareResult::Key(bump.alloc_slice_copy(val)));
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
        fn expand_env_vars(&mut self, bump: &'a Arena, val: &[u8]) -> OOM<&'a [u8]> {
            // Quick check if there are any env vars to expand
            if bun_core::index_of(val, b"${").is_none() {
                // TODO(port): lifetime — Zig returns `val` directly (arena-borrowed).
                return Ok(bump.alloc_slice_copy(val));
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
                                return self.parse_env_substitution(val, start, j, depth + 1, unesc);
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
            // SAFETY: `head` is the same allocation as `rope`'s initial value;
            // we walk `rope` forward via `append` while keeping `head` to return.
            // PORT NOTE: reshaped for borrowck — Zig holds two *Rope simultaneously.
            let head: *mut Rope = std::ptr::from_mut::<Rope>(rope_head);
            let mut rope: *mut Rope = head;

            while dot_idx + 1 < key.len() {
                let next_dot_idx = match next_dot(&key[dot_idx + 1..]) {
                    Some(n) => dot_idx + 1 + n,
                    None => {
                        let rest = &key[dot_idx + 1..];
                        // SAFETY: `rope` points into a live bump allocation; no aliasing borrow.
                        rope = unsafe { &mut *rope }
                            .append(Expr::init(E::EString::init(rest), Loc::EMPTY), ropealloc)?;
                        break;
                    }
                };
                let part = &key[dot_idx + 1..next_dot_idx];
                // SAFETY: `rope` points into a live bump allocation; no aliasing borrow.
                rope = unsafe { &mut *rope }
                    .append(Expr::init(E::EString::init(part), Loc::EMPTY), ropealloc)?;
                dot_idx = next_dot_idx;
            }

            let _ = rope;
            // SAFETY: head was created by ropealloc.alloc above and is still live in the bump.
            Ok(unsafe { &mut *head })
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
                ExprData::ENumber(n) => write!(writer, "{}", n.value),
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
                        // PORT NOTE: Zig builds this list at comptime by reversing
                        // `std.meta.fieldNames(Item.Opt)` so that `_authToken` is
                        // matched before `_auth`. We hard-code the reversed order.
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
                                            // PERF(port): Zig borrowed arena slices here; we box.
                                            registry_url: Box::<[u8]>::from(url_part),
                                            value: Box::<[u8]>::from(value),
                                            optname: opt,
                                            loc: keyexpr.loc,
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
                    if bun_core::has_prefix(key, b"@") && bun_core::ends_with(key, b":registry") {
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
                                // PERF(port): Zig borrowed arena slice here; we box.
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

        // npmrc registry configurations are shared between all npmrc files
        // so we need to collect them as we go for the final registry map
        // to be created at the end.
        let mut configs: Vec<ConfigItem> = Vec::new();

        for &npmrc_path in npmrc_paths {
            let source = match bun_ast::source_from_file(
                npmrc_path,
                bun_ast::ToSourceOpts { convert_bom: true },
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
            // `source.contents` is owned; drops at end of loop iteration.

            match load_npmrc(install, env, npmrc_path, &mut log, &source, &mut configs) {
                Ok(()) => {}
                Err(AllocError) => bun_core::out_of_memory(),
            }
            if log.has_errors() {
                if log.errors == 1 {
                    Output::warn(&format_args!(
                        "Encountered an error while reading <b>{}<r>:\n\n",
                        bstr::BStr::new(npmrc_path.as_bytes()),
                    ));
                } else {
                    Output::warn(&format_args!(
                        "Encountered errors while reading <b>{}<r>:\n\n",
                        bstr::BStr::new(npmrc_path.as_bytes()),
                    ));
                }
                Output::flush();
            }
            let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
                Output::error_writer(),
            ));
        }
    }

    pub fn load_npmrc(
        install: &mut BunInstall,
        env: &mut DotEnvLoader<'_>,
        npmrc_path: &ZStr,
        log: &mut Log,
        source: &Source,
        configs: &mut Vec<ConfigItem>,
    ) -> OOM<()> {
        // TODO(port): lifetime — `Parser<'a>` ties `src` and `env: &'a mut DotEnvLoader<'a>`
        // to a single invariant `'a`; threading that through this fn signature poisons
        // the `load_npmrc_config` loop (env borrowed-for-'a across iterations). The
        // local `parser` is dropped before this fn returns, so erase both to a fresh
        // `'p` (matches `Parser::init`'s own erasures for `path`/`src`).
        // SAFETY: `parser` does not outlive `env`/`source.contents`.
        let contents: &'static [u8] = source.contents.as_ref().into_str();
        // Round-trip through a raw pointer to erase both the borrow and the inner
        // lifetime; identical bit-pattern.
        let env = unsafe { &mut *(env as *mut DotEnvLoader<'_> as *mut DotEnvLoader<'static>) };
        let mut parser = Parser::init(npmrc_path.as_bytes(), contents, env);
        // TODO(port): borrowck — `parser.arena` is borrowed while `parser` is `&mut`.
        // SAFETY: arena outlives all bump-allocated slices used below; Phase B should
        // restructure Parser so the bump is passed externally or split borrows.
        let bump: &Arena = unsafe { &*(&raw const parser.arena) };
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
                } else if install_strategy_str == b"nested" {
                    // TODO
                } else if install_strategy_str == b"shallow" {
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

        let mut registry_map = install
            .scoped
            .take()
            .unwrap_or_else(NpmRegistryMap::default);

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

            // PORT NOTE: Zig's `defer install.scoped = registry_map;` is a shallow
            // write-back at scope end while later code keeps mutating `registry_map`.
            // Reshaped for borrowck: the single write-back happens at the bottom of
            // `load_npmrc` after the registry-configuration block.
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

        // Process registry configuration
        'out: {
            let count = {
                let mut count: usize = configs.len();
                for prop in out_obj.properties.slice() {
                    if let Some(keyexpr) = &prop.key {
                        if let Some(key) = keyexpr.as_utf8_string_literal() {
                            if bun_core::has_prefix(key, b"//") {
                                count += 1;
                            }
                        }
                    }
                }
                count
            };

            if count == 0 {
                break 'out;
            }

            // PORT NOTE: `URL<'a>` borrows its input. The Zig `default_registry_url`
            // points into `install.default_registry.url` while the loop below
            // mutates that same field; copy the two fields we compare against so
            // the borrow ends before the `install.default_registry` mutation.
            let (default_registry_host, default_registry_pathname): (Box<[u8]>, Box<[u8]>) = 'brk: {
                if let Some(dr) = &install.default_registry {
                    let u = URL::parse(&dr.url);
                    break 'brk (Box::from(u.host), Box::from(u.pathname));
                }
                let u = URL::parse(
                    bun_install_types::NodeLinker::npm::Registry::DEFAULT_URL.as_bytes(),
                );
                (Box::from(u.host), Box::from(u.pathname))
            };

            // I don't like having to do this but we'll need a mapping of scope -> bun.URL
            // Because we need to check different parts of the URL, for instance in this
            // example .npmrc:
            let _ = r#"
 @myorg:registry=https://somewhere-else.com/myorg
 @another:registry=https://somewhere-else.com/another

 //somewhere-else.com/myorg/:_authToken=MYTOKEN1

 //somewhere-else.com/:username=foobar

"#;
            // The line that sets the auth token should only apply to the @myorg scope
            // The line that sets the username would apply to both @myorg and @another
            let mut url_map = {
                // PERF(port): was StringArrayHashMap<URL> on parser.arena. `URL<'a>`
                // borrows `v.url` (inside `registry_map.scopes`), which would alias the
                // `values_mut()` iteration below. Store the owned URL bytes instead and
                // re-parse per lookup (URL::parse is a cheap slice scan).
                let mut url_map: ArrayHashMap<Box<[u8]>, Box<[u8]>> =
                    ArrayHashMap::with_capacity(registry_map.scopes.keys().len());

                for (k, v) in registry_map
                    .scopes
                    .keys()
                    .iter()
                    .zip(registry_map.scopes.values())
                {
                    url_map.put(Box::<[u8]>::from(&**k), Box::<[u8]>::from(&*v.url))?;
                }

                url_map
            };

            let mut iter = ConfigIterator {
                config: out_obj,
                source,
                log,
                prop_idx: 0,
            };

            while let Some(val) = iter.next() {
                if let Some(conf_item_) = val.get() {
                    // `conf_item` will look like:
                    //
                    // - localhost:4873/
                    // - somewhere-else.com/myorg/
                    //
                    // Scoped registries are set like this:
                    // - @myorg:registry=https://somewhere-else.com/myorg
                    let conf_item: &ConfigItem = &conf_item_;
                    match conf_item.optname {
                        ConfigOpt::Certfile | ConfigOpt::Keyfile => {
                            iter.log.add_warning_fmt(
                            Some(source),
                            iter.config.properties.at(iter.prop_idx - 1).key.as_ref().unwrap().loc,
                            format_args!(
                                "The following .npmrc registry option was not applied:\n\n  <b>{}<r>\n\nBecause we currently don't support the <b>{}<r> option.",
                                conf_item,
                                <&'static str>::from(conf_item.optname),
                            ),
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

            for conf_item in configs.iter() {
                let conf_item_url = URL::parse(&conf_item.registry_url);

                if bun_core::without_trailing_slash(&default_registry_host)
                    == bun_core::without_trailing_slash(conf_item_url.host)
                    && bun_core::without_trailing_slash(&default_registry_pathname)
                        == bun_core::without_trailing_slash(conf_item_url.pathname)
                {
                    // Apply config to default registry
                    let v: &mut NpmRegistry = 'brk: {
                        if let Some(r) = install.default_registry.as_mut() {
                            break 'brk r;
                        }
                        install.default_registry = Some(NpmRegistry {
                            password: Box::default(),
                            token: Box::default(),
                            username: Box::default(),
                            url: Box::<[u8]>::from(
                                bun_install_types::NodeLinker::npm::Registry::DEFAULT_URL
                                    .as_bytes(),
                            ),
                            email: Box::default(),
                        });
                        install.default_registry.as_mut().unwrap()
                    };

                    match conf_item.optname {
                        ConfigOpt::_AuthToken => {
                            if let Some(x) = conf_item.dupe_value_decoded(log, source)? {
                                v.token = x;
                            }
                        }
                        ConfigOpt::Username => {
                            if let Some(x) = conf_item.dupe_value_decoded(log, source)? {
                                v.username = x;
                            }
                        }
                        ConfigOpt::_Password => {
                            if let Some(x) = conf_item.dupe_value_decoded(log, source)? {
                                v.password = x;
                            }
                        }
                        ConfigOpt::_Auth => {
                            handle_auth(v, conf_item, log, source)?;
                        }
                        ConfigOpt::Email => {
                            if let Some(x) = conf_item.dupe_value_decoded(log, source)? {
                                v.email = x;
                            }
                        }
                        ConfigOpt::Certfile | ConfigOpt::Keyfile => unreachable!(),
                    }
                }

                // PORT NOTE: Zig iterated `registry_map.scopes` and looked up `url_map[k]`
                // by key. In Rust `keys()`/`values_mut()` on the same map alias; since
                // `url_map` was filled in lockstep with `registry_map.scopes` (same
                // ArrayHashMap insertion order), zip its values directly instead.
                for (url_bytes, v) in url_map
                    .values()
                    .iter()
                    .zip(registry_map.scopes.values_mut())
                {
                    let url = URL::parse(url_bytes);

                    if bun_core::without_trailing_slash(url.host)
                        == bun_core::without_trailing_slash(conf_item_url.host)
                        && bun_core::without_trailing_slash(url.pathname)
                            == bun_core::without_trailing_slash(conf_item_url.pathname)
                    {
                        if !conf_item_url.hostname.is_empty() {
                            if bun_core::without_trailing_slash(url.hostname)
                                != bun_core::without_trailing_slash(conf_item_url.hostname)
                            {
                                continue;
                            }
                        }
                        // Apply config to scoped registry
                        match conf_item.optname {
                            ConfigOpt::_AuthToken => {
                                if let Some(x) = conf_item.dupe_value_decoded(log, source)? {
                                    v.token = x;
                                }
                            }
                            ConfigOpt::Username => {
                                if let Some(x) = conf_item.dupe_value_decoded(log, source)? {
                                    v.username = x;
                                }
                            }
                            ConfigOpt::_Password => {
                                if let Some(x) = conf_item.dupe_value_decoded(log, source)? {
                                    v.password = x;
                                }
                            }
                            ConfigOpt::_Auth => {
                                handle_auth(v, conf_item, log, source)?;
                            }
                            ConfigOpt::Email => {
                                if let Some(x) = conf_item.dupe_value_decoded(log, source)? {
                                    v.email = x;
                                }
                            }
                            ConfigOpt::Certfile | ConfigOpt::Keyfile => unreachable!(),
                        }
                        // We have to keep going as it could match multiple scopes
                        continue;
                    }
                }
            }

            drop(url_map);
        }

        // TODO(port): Zig's `defer install.scoped = registry_map;` (in the scope-processing
        // block) writes back the *final* registry_map after the registry-configuration block
        // mutates it. Mirror that here.
        install.scoped = Some(registry_map);

        Ok(())
    }

    use bun_install_types::NodeLinker::{
        Behavior as PnpmBehavior, CreateMatcherError, FromExprError, Matcher as PnpmMatcherEntry,
        PnpmMatcher, create_matcher,
    };

    /// Port of `PnpmMatcher.fromExpr` (src/install/PnpmMatcher.zig) operating on
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

    fn handle_auth(
        v: &mut NpmRegistry,
        conf_item: &ConfigItem,
        log: &mut Log,
        source: &Source,
    ) -> OOM<()> {
        if conf_item.value.is_empty() {
            log.add_error_opts(
            b"invalid _auth value, expected base64 encoded \"<username>:<password>\", received an empty string",
            bun_ast::AddErrorOptions {
                source: Some(source),
                loc: conf_item.loc,
                redact_sensitive_information: true,
                ..Default::default()
            },
        );
            return Ok(());
        }
        let decode_len = bun_base64::decode_len(&conf_item.value);
        let mut decoded = vec![0u8; decode_len].into_boxed_slice();
        let result = bun_base64::decode(&mut decoded[..], &conf_item.value);
        if !result.is_successful() {
            log.add_error_opts(
                b"invalid _auth value, expected valid base64",
                bun_ast::AddErrorOptions {
                    source: Some(source),
                    loc: conf_item.loc,
                    redact_sensitive_information: true,
                    ..Default::default()
                },
            );
            return Ok(());
        }
        let username_password = &decoded[..result.count];
        let Some(colon_idx) = username_password.iter().position(|&b| b == b':') else {
            log.add_error_opts(
                b"invalid _auth value, expected base64 encoded \"<username>:<password>\"",
                bun_ast::AddErrorOptions {
                    source: Some(source),
                    loc: conf_item.loc,
                    redact_sensitive_information: true,
                    ..Default::default()
                },
            );
            return Ok(());
        };
        let username = &username_password[..colon_idx];
        if colon_idx + 1 >= username_password.len() {
            log.add_error_opts(
                b"invalid _auth value, expected base64 encoded \"<username>:<password>\"",
                bun_ast::AddErrorOptions {
                    source: Some(source),
                    loc: conf_item.loc,
                    redact_sensitive_information: true,
                    ..Default::default()
                },
            );
            return Ok(());
        }
        let password = &username_password[colon_idx + 1..];
        v.username = Box::<[u8]>::from(username);
        v.password = Box::<[u8]>::from(password);
        Ok(())
    }
} // mod draft

// ported from: src/ini/ini.zig
