use core::fmt;
use core::marker::ConstParamTy;
use std::io::Write as _;

use bun_alloc::{AllocError, Arena}; // Arena = bumpalo::Bump
use bun_collections::ArrayHashMap;
use bun_core::{Global, Output};
use bun_dot_env::Loader as DotEnvLoader;
use bun_js_parser::e::object::Rope;
use bun_js_parser::{self as js_ast, E, Expr};
use bun_logger::{self as logger, Loc, Log, Source};
use bun_schema::api::{BunInstall, NpmRegistry, NpmRegistryMap};
use bun_str::{strings, ZStr};
use bun_url::URL;

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
    pub env: &'a mut DotEnvLoader,
}

pub struct Options {
    pub bracked_array: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self { bracked_array: true }
    }
}

// PORT NOTE: Zig `prepareStr` switches its *return type* on a comptime enum
// param (`.section -> *Rope`, `.key -> []const u8`, `.value -> Expr`). Rust
// const generics cannot select a return type, so we keep a single
// `prepare_str::<USAGE>()` body for diffability and wrap the result in
// `PrepareResult`. Callers unwrap with `.into_*()`.
#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
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
    #[inline]
    fn into_value(self) -> Expr {
        match self {
            PrepareResult::Value(e) => e,
            _ => unreachable!(),
        }
    }
    #[inline]
    fn into_section(self) -> &'bump mut Rope {
        match self {
            PrepareResult::Section(r) => r,
            _ => unreachable!(),
        }
    }
    #[inline]
    fn into_key(self) -> &'bump [u8] {
        match self {
            PrepareResult::Key(s) => s,
            _ => unreachable!(),
        }
    }
}

impl<'a> Parser<'a> {
    pub fn init(path: &[u8], src: &'a [u8], env: &'a mut DotEnvLoader) -> Parser<'a> {
        Parser {
            opts: Options::default(),
            logger: Log::init(),
            src,
            out: Expr::init(E::Object(E::Object::default()), Loc::EMPTY),
            source: Source::init_path_string(path, src),
            arena: Arena::new(),
            env,
        }
    }

    // deinit -> Drop: `logger` and `arena` are owned and drop automatically.

    #[inline]
    fn should_skip_line(line: &[u8]) -> bool {
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

    pub fn parse(&mut self, bump: &'a Arena) -> OOM<()> {
        // TODO(port): borrowck — in Zig, `arena_allocator` is `self.arena.allocator()`;
        // here it is passed separately to avoid overlapping &mut self borrows.
        let src = self.src;
        let mut iter = src.split(|&b| b == b'\n');
        // TODO(port): borrowck — `head` aliases into `self.out.data.e_object` while
        // `self` is also borrowed mutably for prepare_str(). Phase B may need raw ptr.
        let mut head: *mut E::Object = self.out.data.e_object_mut();

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
            if Self::should_skip_line(line) {
                continue;
            }

            // Section
            // [foo]
            if line[0] == b'[' {
                let mut treat_as_key = false;
                'treat_as_key: {
                    skip_until_next_section = false;
                    let Some(close_bracket_idx) =
                        line.iter().position(|&b| b == b']')
                    else {
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
                        .prepare_str::<{ Usage::Section }>(
                            bump,
                            ropealloc,
                            &line[1..close_bracket_idx],
                            offset,
                        )?
                        .into_section();
                    // PERF(port): was `rope_stack.fixed_buffer_allocator.reset()` here.
                    // SAFETY: head is a valid &mut E::Object derived from self.out.
                    let root = unsafe { &mut *self.out.data.e_object_mut() };
                    let parent_object = match root.get_or_put_object(section, bump) {
                        Ok(v) => v,
                        Err(e) if e == bun_core::err!("OutOfMemory") => {
                            return Err(AllocError);
                        }
                        Err(_clobber) => {
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
                    head = parent_object.data.e_object_mut();
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

            let line_offset =
                i32::try_from(line.as_ptr() as usize - src.as_ptr() as usize).unwrap();

            let maybe_eq_sign_idx = line.iter().position(|&b| b == b'=');

            let key_raw: &[u8] = self
                .prepare_str::<{ Usage::Key }>(
                    bump,
                    ropealloc,
                    &line[..maybe_eq_sign_idx.unwrap_or(line.len())],
                    line_offset,
                )?
                .into_key();
            let is_array: bool = {
                key_raw.len() > 2 && strings::ends_with(key_raw, b"[]")
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

            let key = if is_array && strings::ends_with(key_raw, b"[]") {
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
                            .prepare_str::<{ Usage::Value }>(
                                bump,
                                ropealloc,
                                &line[eq_sign_idx + 1..],
                                line_offset + i32::try_from(eq_sign_idx).unwrap() + 1,
                            )?
                            .into_value();
                    }
                    break 'brk Expr::init(
                        E::String(E::String { data: b"" }),
                        Loc::EMPTY,
                    );
                }
                Expr::init(E::Boolean(E::Boolean { value: true }), Loc::EMPTY)
            };

            let value: Expr = match &value_raw.data {
                js_ast::ExprData::EString(s) => {
                    if s.data == b"true" {
                        Expr::init(E::Boolean(E::Boolean { value: true }), Loc::EMPTY)
                    } else if s.data == b"false" {
                        Expr::init(E::Boolean(E::Boolean { value: false }), Loc::EMPTY)
                    } else if s.data == b"null" {
                        Expr::init(E::Null(E::Null {}), Loc::EMPTY)
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
                    if !val.data.is_e_array() {
                        let mut arr = E::Array::default();
                        arr.push(bump, val)?;
                        head_ref.put(bump, key, Expr::init(E::Array(arr), Loc::EMPTY))?;
                    }
                } else {
                    head_ref.put(
                        bump,
                        key,
                        Expr::init(E::Array(E::Array::default()), Loc::EMPTY),
                    )?;
                }
            }

            // safeguard against resetting a previously defined
            // array by accidentally forgetting the brackets
            let mut was_already_array = false;
            if let Some(val) = head_ref.get(key) {
                if val.data.is_e_array() {
                    was_already_array = true;
                    val.data.e_array_mut().push(bump, value)?;
                    head_ref.put(bump, key, val)?;
                }
            }
            if !was_already_array {
                head_ref.put(bump, key, value)?;
            }
        }
        Ok(())
    }

    fn prepare_str<const USAGE: Usage>(
        &mut self,
        bump: &'a Arena,
        ropealloc: &'a Arena,
        val_: &[u8],
        offset_: i32,
    ) -> OOM<PrepareResult<'a>> {
        let mut offset = offset_;
        let mut val = strings::trim(val_, b" \n\r\t");

        if Self::is_quoted(val) {
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
                let src = Source::init_path_string(self.source.path.text.as_slice(), val);
                let mut log = Log::init();
                // Try to parse it and if it fails will just treat it as a string
                let json_val: Expr = match bun_json::parse_utf8_impl(&src, &mut log, bump, true) {
                    Ok(v) => v,
                    Err(_) => {
                        // JSON parse failed (e.g., single-quoted string like '${VAR}')
                        // Still need to expand env vars in the content
                        if USAGE == Usage::Value {
                            let expanded = self.expand_env_vars(bump, val)?;
                            return Ok(PrepareResult::Value(Expr::init(
                                E::String(E::String::init(expanded)),
                                Loc { start: offset },
                            )));
                        }
                        break 'out;
                    }
                };
                drop(log);

                if let Some(str_) = json_val.as_string(bump) {
                    // Expand env vars in the JSON-parsed string
                    let expanded = if USAGE == Usage::Value {
                        self.expand_env_vars(bump, str_)?
                    } else {
                        str_
                    };
                    if USAGE == Usage::Value {
                        return Ok(PrepareResult::Value(Expr::init(
                            E::String(E::String::init(expanded)),
                            Loc { start: offset },
                        )));
                    }
                    if USAGE == Usage::Section {
                        return Ok(PrepareResult::Section(Self::str_to_rope(
                            ropealloc, expanded,
                        )?));
                    }
                    return Ok(PrepareResult::Key(expanded));
                }

                if USAGE == Usage::Value {
                    return Ok(PrepareResult::Value(json_val));
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
                    js_ast::ExprData::EObject(_) => {
                        if USAGE == Usage::Section {
                            return Ok(PrepareResult::Section(Self::single_str_rope(
                                ropealloc,
                                b"[Object object]",
                            )?));
                        }
                        return Ok(PrepareResult::Key(b"[Object object]"));
                    }
                    _ => {
                        // PERF(port): was std.fmt.allocPrint into arena
                        let mut buf = bumpalo::collections::Vec::<u8>::new_in(bump);
                        write!(&mut buf, "{}", ToStringFormatter { d: &json_val.data })
                            .map_err(|_| AllocError)?;
                        let str_ = buf.into_bump_slice();
                        if USAGE == Usage::Section {
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
            let mut unesc =
                bumpalo::collections::Vec::<u8>::with_capacity_in(STACK_BUF_SIZE, bump);

            // RopeT is *Rope when USAGE==Section, else unit. In Rust we just
            // keep an Option<&mut Rope> and ignore it for non-section usages.
            let mut rope: Option<&'a mut Rope> = None;

            let mut i: usize = 0;
            while i < val.len() {
                let c = val[i];
                if esc {
                    match c {
                        b'\\' => unesc.extend_from_slice(&[b'\\']),
                        b';' | b'#' | b'$' => unesc.push(c),
                        b'.' => {
                            if USAGE == Usage::Section {
                                unesc.push(b'.');
                            } else {
                                unesc.extend_from_slice(b"\\.");
                            }
                        }
                        _ => match strings::utf8_byte_sequence_length(c) {
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
                                    unesc.extend_from_slice(&[b'\\', c, val[i + 1], val[i + 2]]);
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
                                        b'\\', c, val[i + 1], val[i + 2], val[i + 3],
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
                                if USAGE != Usage::Value {
                                    break 'not_env_substitution;
                                }

                                if let Some(new_i) =
                                    self.parse_env_substitution(val, i, i, &mut unesc)?
                                {
                                    // set to true so we heap alloc
                                    did_any_escape = true;
                                    i = new_i;
                                    i += 1;
                                    continue;
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
                            if USAGE == Usage::Section {
                                self.commit_rope_part(bump, ropealloc, &mut unesc, &mut rope)?;
                            } else {
                                unesc.push(b'.');
                            }
                        }
                        _ => match strings::utf8_byte_sequence_length(c) {
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
                                    unesc.extend_from_slice(&[c, val[i + 1], val[i + 2], val[i + 3]]);
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

            match USAGE {
                Usage::Section => {
                    self.commit_rope_part(bump, ropealloc, &mut unesc, &mut rope)?;
                    return Ok(PrepareResult::Section(rope.unwrap()));
                }
                Usage::Value => {
                    if !did_any_escape {
                        return Ok(PrepareResult::Value(Expr::init(
                            E::String(E::String::init(val)),
                            Loc { start: offset },
                        )));
                    }
                    if unesc.len() <= STACK_BUF_SIZE {
                        return Ok(PrepareResult::Value(Expr::init(
                            E::String(E::String::init(bump.alloc_slice_copy(&unesc))),
                            Loc { start: offset },
                        )));
                    }
                    return Ok(PrepareResult::Value(Expr::init(
                        E::String(E::String::init(unesc.into_bump_slice())),
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
        if USAGE == Usage::Value {
            return Ok(PrepareResult::Value(Expr::init(
                E::String(E::String::init(val)),
                Loc { start: offset },
            )));
        }
        if USAGE == Usage::Key {
            return Ok(PrepareResult::Key(val));
            // TODO(port): lifetime — `val` borrows `val_` (caller line slice);
            // Zig returns it directly. Phase B may need bump.alloc_slice_copy here.
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
        if strings::index_of(val, b"${").is_none() {
            // TODO(port): lifetime — Zig returns `val` directly (arena-borrowed).
            return Ok(bump.alloc_slice_copy(val));
        }

        let mut result = bumpalo::collections::Vec::<u8>::with_capacity_in(val.len(), bump);
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
        unesc: &mut bumpalo::collections::Vec<'a, u8>,
    ) -> OOM<Option<usize>> {
        debug_assert!(val[i] == b'$');
        let mut esc = false;
        if i + b"{}".len() < val.len() && val[i + 1] == b'{' {
            let mut found_closing = false;
            let mut j = i + 2;
            while j < val.len() {
                match val[j] {
                    b'\\' => esc = !esc,
                    b'$' => {
                        if !esc {
                            return self.parse_env_substitution(val, start, j, unesc);
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
            let optional = !env_var_raw.is_empty() && env_var_raw[env_var_raw.len() - 1] == b'?';
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

    fn single_str_rope(ropealloc: &'a Arena, str_: &'a [u8]) -> OOM<&'a mut Rope> {
        let rope = ropealloc.alloc(Rope {
            head: Expr::init(E::String(E::String::init(str_)), Loc::EMPTY),
            next: None,
        });
        Ok(rope)
    }

    fn next_dot(key: &[u8]) -> Option<usize> {
        key.iter().position(|&b| b == b'.')
    }

    fn commit_rope_part(
        &mut self,
        bump: &'a Arena,
        ropealloc: &'a Arena,
        unesc: &mut bumpalo::collections::Vec<'a, u8>,
        existing_rope: &mut Option<&'a mut Rope>,
    ) -> OOM<()> {
        let _ = self; // autofix
        let slice = bump.alloc_slice_copy(&unesc[..]);
        let expr = Expr::init(E::String(E::String { data: slice }), Loc::EMPTY);
        if let Some(r) = existing_rope.as_deref_mut() {
            let _ = r.append(expr, ropealloc)?;
        } else {
            *existing_rope = Some(ropealloc.alloc(Rope {
                head: expr,
                next: None,
            }));
        }
        unesc.clear();
        Ok(())
    }

    fn str_to_rope(ropealloc: &'a Arena, key: &'a [u8]) -> OOM<&'a mut Rope> {
        let Some(mut dot_idx) = Self::next_dot(key) else {
            let rope = ropealloc.alloc(Rope {
                head: Expr::init(E::String(E::String::init(key)), Loc::EMPTY),
                next: None,
            });
            return Ok(rope);
        };
        let mut rope: &mut Rope = ropealloc.alloc(Rope {
            head: Expr::init(E::String(E::String::init(&key[..dot_idx])), Loc::EMPTY),
            next: None,
        });
        // SAFETY: `head` is the same allocation as `rope`'s initial value;
        // we walk `rope` forward via `append` while keeping `head` to return.
        // PORT NOTE: reshaped for borrowck — Zig holds two *Rope simultaneously.
        let head: *mut Rope = rope as *mut Rope;

        while dot_idx + 1 < key.len() {
            let next_dot_idx = match Self::next_dot(&key[dot_idx + 1..]) {
                Some(n) => dot_idx + 1 + n,
                None => {
                    let rest = &key[dot_idx + 1..];
                    rope = rope.append(
                        Expr::init(E::String(E::String::init(rest)), Loc::EMPTY),
                        ropealloc,
                    )?;
                    break;
                }
            };
            let part = &key[dot_idx + 1..next_dot_idx];
            rope = rope.append(
                Expr::init(E::String(E::String::init(part)), Loc::EMPTY),
                ropealloc,
            )?;
            dot_idx = next_dot_idx;
        }

        // SAFETY: head was created by ropealloc.alloc above and is still live in the bump.
        Ok(unsafe { &mut *head })
    }

    fn is_quoted(val: &[u8]) -> bool {
        (strings::starts_with_char(val, b'"') && strings::ends_with_char(val, b'"'))
            || (strings::starts_with_char(val, b'\'') && strings::ends_with_char(val, b'\''))
    }
}

// `IniTestingAPIs` — *_jsc alias deleted (see PORTING.md "Idiom map").

// ──────────────────────────────────────────────────────────────────────────
// ToStringFormatter
// ──────────────────────────────────────────────────────────────────────────

pub struct ToStringFormatter<'a> {
    pub d: &'a js_ast::ExprData,
}

impl fmt::Display for ToStringFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.d {
            js_ast::ExprData::EArray(arr) => {
                let last = arr.items.len().saturating_sub(1);
                for (i, e) in arr.items.slice().iter().enumerate() {
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
            js_ast::ExprData::EObject(_) => write!(writer, "[Object object]"),
            js_ast::ExprData::EBoolean(b) => {
                write!(writer, "{}", if b.value { "true" } else { "false" })
            }
            js_ast::ExprData::ENumber(n) => write!(writer, "{}", n.value),
            js_ast::ExprData::EString(s) => {
                write!(writer, "{}", bstr::BStr::new(s.data))
            }
            js_ast::ExprData::ENull(_) => write!(writer, "null"),

            tag => {
                if cfg!(debug_assertions) {
                    Output::panic(format_args!(
                        "Unexpected AST node: {}",
                        <&'static str>::from(tag)
                    ));
                }
                Ok(())
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Option(T) — tri-state used by iterators (None != end-of-iteration)
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
// ConfigIterator
// ──────────────────────────────────────────────────────────────────────────

pub struct ConfigIterator<'a> {
    pub config: &'a E::Object,
    pub source: &'a Source,
    pub log: &'a mut Log,

    pub prop_idx: usize,
}

pub struct ConfigItem {
    pub registry_url: Box<[u8]>,
    pub optname: ConfigOpt,
    pub value: Box<[u8]>,
    pub loc: Loc,
}

#[derive(
    Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString,
)]
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
    pub fn dupe_value_decoded(
        &self,
        log: &mut Log,
        source: &Source,
    ) -> OOM<Option<Box<[u8]>>> {
        if self.optname.is_base64_encoded() {
            if self.value.is_empty() {
                return Ok(Some(Box::default()));
            }
            let len = bun_base64::decode_len(&self.value);
            let mut slice = vec![0u8; len].into_boxed_slice();
            let result = bun_base64::decode(&mut slice[..], &self.value);
            if result.status != bun_base64::DecodeStatus::Success {
                log.add_error_fmt_opts(
                    format_args!("{} is not valid base64", <&'static str>::from(self.optname)),
                    logger::AddErrorOpts {
                        source: Some(source),
                        loc: self.loc,
                        ..Default::default()
                    },
                )?;
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

impl<'a> ConfigIterator<'a> {
    pub fn next(&mut self) -> Option<IniOption<ConfigItem>> {
        if self.prop_idx >= self.config.properties.len() {
            return None;
        }
        let prop_idx = self.prop_idx;
        self.prop_idx += 1;

        let prop = &self.config.properties.ptr()[prop_idx];

        if let Some(keyexpr) = &prop.key {
            if let Some(key) = keyexpr.as_utf8_string_literal() {
                if strings::has_prefix(key, b"//") {
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

                        if let Some(index) = strings::last_index_of(key, name_with_eq) {
                            let url_part = &key[2..index];
                            if let Some(value_expr) = &prop.value {
                                if let Some(value) = value_expr.as_utf8_string_literal() {
                                    return Some(IniOption::Some(ConfigItem {
                                        // PERF(port): Zig borrowed arena slices here; we box.
                                        registry_url: Box::<[u8]>::from(url_part),
                                        value: Box::<[u8]>::from(value),
                                        optname: opt,
                                        loc: prop.key.as_ref().unwrap().loc,
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
// NodeLinkerMap
// ──────────────────────────────────────────────────────────────────────────

static NODE_LINKER_MAP: phf::Map<
    &'static [u8],
    bun_install::package_manager::options::NodeLinker,
> = phf::phf_map! {
    // yarn
    b"pnpm" => bun_install::package_manager::options::NodeLinker::Isolated,
    b"node-modules" => bun_install::package_manager::options::NodeLinker::Hoisted,
    // pnpm
    b"isolated" => bun_install::package_manager::options::NodeLinker::Isolated,
    b"hoisted" => bun_install::package_manager::options::NodeLinker::Hoisted,
};

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

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ScopeError {
    #[error("no_value")]
    NoValue,
}

pub struct ScopeItem {
    pub scope: Box<[u8]>,
    pub registry: NpmRegistry,
}

impl<'a> ScopeIterator<'a> {
    pub fn next(&mut self) -> OOM<Option<IniOption<ScopeItem>>> {
        if self.prop_idx >= self.config.properties.len() {
            return Ok(None);
        }
        let prop_idx = self.prop_idx;
        self.prop_idx += 1;

        let prop = &self.config.properties.ptr()[prop_idx];

        if let Some(keyexpr) = &prop.key {
            if let Some(key) = keyexpr.as_utf8_string_literal() {
                if strings::has_prefix(key, b"@") && strings::ends_with(key, b":registry") {
                    if !self.count {
                        let registry = 'brk: {
                            if let Some(value) = &prop.value {
                                if let Some(str_) = value.as_utf8_string_literal() {
                                    let mut parser = bun_schema::api::npm_registry::Parser {
                                        log: self.log,
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
    env: &mut DotEnvLoader,
    auto_loaded: bool,
    npmrc_paths: &[&ZStr],
) {
    let mut log = Log::init();

    // npmrc registry configurations are shared between all npmrc files
    // so we need to collect them as we go for the final registry map
    // to be created at the end.
    let mut configs: Vec<ConfigItem> = Vec::new();

    for &npmrc_path in npmrc_paths {
        let source = match bun_sys::File::to_source(
            npmrc_path,
            bun_sys::ToSourceOpts { convert_bom: true },
        ) {
            Ok(s) => s,
            Err(err) => {
                if auto_loaded {
                    continue;
                }
                Output::err(
                    err,
                    format_args!("failed to read .npmrc: \"{}\"", bstr::BStr::new(npmrc_path.as_bytes())),
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
                Output::warn(format_args!(
                    "Encountered an error while reading <b>{}<r>:\n\n",
                    bstr::BStr::new(npmrc_path.as_bytes())
                ));
            } else {
                Output::warn(format_args!(
                    "Encountered errors while reading <b>{}<r>:\n\n",
                    bstr::BStr::new(npmrc_path.as_bytes())
                ));
            }
            Output::flush();
        }
        let _ = log.print(Output::error_writer());
    }
}

pub fn load_npmrc(
    install: &mut BunInstall,
    env: &mut DotEnvLoader,
    npmrc_path: &ZStr,
    log: &mut Log,
    source: &Source,
    configs: &mut Vec<ConfigItem>,
) -> OOM<()> {
    let mut parser = Parser::init(npmrc_path.as_bytes(), source.contents.as_slice(), env);
    // TODO(port): borrowck — `parser.arena` is borrowed while `parser` is `&mut`.
    // SAFETY: arena outlives all bump-allocated slices used below; Phase B should
    // restructure Parser so the bump is passed externally or split borrows.
    let bump: &Arena = unsafe { &*(&parser.arena as *const Arena) };
    parser.parse(bump)?;
    // Need to be very, very careful here with strings.
    // They are allocated in the Parser's arena, which of course gets
    // deinitialized at the end of the scope.
    // We need to dupe all strings
    let out = &parser.out;

    if let Some(query) = out.as_property(b"registry") {
        if let Some(str_) = query.expr.as_utf8_string_literal() {
            let mut p = bun_schema::api::npm_registry::Parser {
                log,
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
            install.ca = Some(bun_schema::api::Ca::Str(Box::<[u8]>::from(str_)));
        } else if query.expr.is_array() {
            let arr = query.expr.data.e_array();
            let mut list: Vec<Box<[u8]>> = Vec::with_capacity(arr.items.len());
            for item in arr.items.slice() {
                if let Some(s) = item.as_string_cloned()? {
                    list.push(s);
                }
            }
            install.ca = Some(bun_schema::api::Ca::List(list.into_boxed_slice()));
        }
    }

    if let Some(query) = out.as_property(b"cafile") {
        if let Some(cafile) = query.expr.as_string_cloned()? {
            install.cafile = Some(cafile);
        }
    }

    if let Some(omit) = out.as_property(b"omit") {
        match &omit.expr.data {
            js_ast::ExprData::EString(str_) => {
                if str_.eql_comptime(b"dev") {
                    install.save_dev = Some(false);
                } else if str_.eql_comptime(b"peer") {
                    install.save_peer = Some(false);
                } else if str_.eql_comptime(b"optional") {
                    install.save_optional = Some(false);
                }
            }
            js_ast::ExprData::EArray(arr) => {
                for item in arr.items.slice() {
                    if let js_ast::ExprData::EString(str_) = &item.data {
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
            js_ast::ExprData::EString(str_) => {
                if str_.eql_comptime(b"dev") {
                    install.save_dev = Some(true);
                } else if str_.eql_comptime(b"peer") {
                    install.save_peer = Some(true);
                } else if str_.eql_comptime(b"optional") {
                    install.save_optional = Some(true);
                }
            }
            js_ast::ExprData::EArray(arr) => {
                for item in arr.items.slice() {
                    if let js_ast::ExprData::EString(str_) = &item.data {
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
                install.node_linker =
                    Some(bun_install::package_manager::options::NodeLinker::Hoisted);
            } else if install_strategy_str == b"linked" {
                install.node_linker =
                    Some(bun_install::package_manager::options::NodeLinker::Isolated);
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
        install.public_hoist_pattern = match bun_install::PnpmMatcher::from_expr(
            public_hoist_pattern_expr,
            log,
            source,
        ) {
            Ok(v) => v,
            Err(e) if e == bun_core::err!("OutOfMemory") => return Err(AllocError),
            Err(_) => {
                // error.InvalidRegExp, error.UnexpectedExpr
                log.reset();
                None
            }
        };
    }

    if let Some(hoist_pattern_expr) = out.get(b"hoist-pattern") {
        install.hoist_pattern = match bun_install::PnpmMatcher::from_expr(
            hoist_pattern_expr,
            log,
            source,
        ) {
            Ok(v) => v,
            Err(e) if e == bun_core::err!("OutOfMemory") => return Err(AllocError),
            Err(_) => {
                // error.InvalidRegExp, error.UnexpectedExpr
                log.reset();
                None
            }
        };
    }

    let mut registry_map = install.scoped.take().unwrap_or_else(NpmRegistryMap::default);

    // Process scopes
    {
        let mut iter = ScopeIterator {
            config: parser.out.data.e_object(),
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
                registry_map
                    .scopes
                    .put(Box::<[u8]>::from(&*result.scope), registry)?;
            }
        }

    }

    // Process registry configuration
    'out: {
        let count = {
            let mut count: usize = configs.len();
            for prop in parser.out.data.e_object().properties.slice() {
                if let Some(keyexpr) = &prop.key {
                    if let Some(key) = keyexpr.as_utf8_string_literal() {
                        if strings::has_prefix(key, b"//") {
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

        let default_registry_url: URL = 'brk: {
            if let Some(dr) = &install.default_registry {
                break 'brk URL::parse(&dr.url);
            }
            URL::parse(bun_install::npm::Registry::DEFAULT_URL)
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
            // PERF(port): was StringArrayHashMap on parser.arena
            let mut url_map: ArrayHashMap<Box<[u8]>, URL> =
                ArrayHashMap::with_capacity(registry_map.scopes.keys().len());

            for (k, v) in registry_map
                .scopes
                .keys()
                .iter()
                .zip(registry_map.scopes.values())
            {
                let url = URL::parse(&v.url);
                url_map.put(Box::<[u8]>::from(&**k), url)?;
            }

            url_map
        };

        let mut iter = ConfigIterator {
            config: parser.out.data.e_object(),
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
                        log.add_warning_fmt(
                            source,
                            iter.config.properties.at(iter.prop_idx - 1).key.as_ref().unwrap().loc,
                            format_args!(
                                "The following .npmrc registry option was not applied:\n\n  <b>{}<r>\n\nBecause we currently don't support the <b>{}<r> option.",
                                conf_item,
                                <&'static str>::from(conf_item.optname),
                            ),
                        )?;
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

            if strings::without_trailing_slash(default_registry_url.host)
                == strings::without_trailing_slash(conf_item_url.host)
                && strings::without_trailing_slash(default_registry_url.pathname)
                    == strings::without_trailing_slash(conf_item_url.pathname)
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
                        url: Box::<[u8]>::from(bun_install::npm::Registry::DEFAULT_URL),
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

            for (k, v) in registry_map
                .scopes
                .keys()
                .iter()
                .zip(registry_map.scopes.values_mut())
            {
                let url = url_map.get(&**k).expect("unreachable");

                if strings::without_trailing_slash(url.host)
                    == strings::without_trailing_slash(conf_item_url.host)
                    && strings::without_trailing_slash(url.pathname)
                        == strings::without_trailing_slash(conf_item_url.pathname)
                {
                    if !conf_item_url.hostname.is_empty() {
                        if strings::without_trailing_slash(url.hostname)
                            != strings::without_trailing_slash(conf_item_url.hostname)
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

fn handle_auth(
    v: &mut NpmRegistry,
    conf_item: &ConfigItem,
    log: &mut Log,
    source: &Source,
) -> OOM<()> {
    if conf_item.value.is_empty() {
        log.add_error_opts(
            "invalid _auth value, expected base64 encoded \"<username>:<password>\", received an empty string",
            logger::AddErrorOpts {
                source: Some(source),
                loc: conf_item.loc,
                redact_sensitive_information: true,
                ..Default::default()
            },
        )?;
        return Ok(());
    }
    let decode_len = bun_base64::decode_len(&conf_item.value);
    let mut decoded = vec![0u8; decode_len].into_boxed_slice();
    let result = bun_base64::decode(&mut decoded[..], &conf_item.value);
    if !result.is_successful() {
        log.add_error_opts(
            "invalid _auth value, expected valid base64",
            logger::AddErrorOpts {
                source: Some(source),
                loc: conf_item.loc,
                redact_sensitive_information: true,
                ..Default::default()
            },
        )?;
        return Ok(());
    }
    let username_password = &decoded[..result.count];
    let Some(colon_idx) = username_password.iter().position(|&b| b == b':') else {
        log.add_error_opts(
            "invalid _auth value, expected base64 encoded \"<username>:<password>\"",
            logger::AddErrorOpts {
                source: Some(source),
                loc: conf_item.loc,
                redact_sensitive_information: true,
                ..Default::default()
            },
        )?;
        return Ok(());
    };
    let username = &username_password[..colon_idx];
    if colon_idx + 1 >= username_password.len() {
        log.add_error_opts(
            "invalid _auth value, expected base64 encoded \"<username>:<password>\"",
            logger::AddErrorOpts {
                source: Some(source),
                loc: conf_item.loc,
                redact_sensitive_information: true,
                ..Default::default()
            },
        )?;
        return Ok(());
    }
    let password = &username_password[colon_idx + 1..];
    v.username = Box::<[u8]>::from(username);
    v.password = Box::<[u8]>::from(password);
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ini/ini.zig (1357 lines)
//   confidence: medium
//   todos:      6
//   notes:      prepare_str return-type-switch wrapped in PrepareResult enum; Parser arena vs &mut self borrowck needs Phase B reshaping; ConfigItem fields boxed (Zig dual borrowed/owned)
// ──────────────────────────────────────────────────────────────────────────
