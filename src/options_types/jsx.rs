//! Port of `bundler/options.zig` `JSX` namespace (`Runtime`, `ImportSource`,
//! `Pragma`, `RuntimeDevelopmentPair`, `RuntimeMap`, `Defaults`).
//!
//! Canonical home (D042): previously triplicated across
//! `bundler/options.rs`, `js_parser/parser.rs`, and
//! `resolver/tsconfig_json.rs` with hand-rolled `From<>` bridges between the
//! nominal copies. All three crates already depend on `bun_options_types`,
//! and `api::Jsx`/`api::JsxRuntime` (the only upward refs) live in this
//! crate's `schema` module — so the type sits cleanly at this tier.

use crate::schema::api;
use bun_core::strings;
use std::borrow::Cow;

/// Port of `options.JSX.Runtime` (options.zig:1359 — `pub const Runtime =
/// api.JsxRuntime;`). 4-state including `_None` so `Pragma.runtime` preserves
/// the zero value when an `api.Jsx` arrives with `runtime == _none` (Zig
/// options.zig:1344 assigns it directly). `#[default]` is `Automatic` (Zig:
/// `runtime: api.Api.JsxRuntime = .automatic`).
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Runtime {
    _None,
    #[default]
    Automatic,
    Classic,
    Solid,
}

impl From<api::JsxRuntime> for Runtime {
    fn from(r: api::JsxRuntime) -> Self {
        match r {
            api::JsxRuntime::_none => Runtime::_None,
            api::JsxRuntime::Classic => Runtime::Classic,
            api::JsxRuntime::Solid => Runtime::Solid,
            api::JsxRuntime::Automatic => Runtime::Automatic,
        }
    }
}

/// Port of `options.JSX.RuntimeDevelopmentPair`.
#[derive(Debug, Clone, Copy)]
pub struct RuntimeDevelopmentPair {
    pub runtime: Runtime,
    pub development: Option<bool>,
}

/// Port of `options.JSX.RuntimeMap` (`bun.ComptimeStringMap`, options.zig:1179).
pub static RUNTIME_MAP: phf::Map<&'static [u8], RuntimeDevelopmentPair> = phf::phf_map! {
    b"classic" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
    b"automatic" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
    b"react" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
    b"react-jsx" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
    b"react-jsxdev" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
};

/// Port of Zig `[]const string` for `Pragma.{factory,fragment}`.
///
/// In Zig (options.zig:1193) the field is a fat slice that, by default, points
/// at the static `Defaults.Factory` array — copying the struct is a 16-byte
/// pointer copy with **zero** allocations. The original Rust port boxed every
/// element (`Box<[Box<[u8]>]>`), making `Pragma::default()` / `Clone` cost ~10
/// heap allocations and dominating mimalloc samples in the resolver hot path.
///
/// `MemberList` restores Zig's cost model: the overwhelmingly-common case
/// (`Static`) borrows a `&'static [&'static [u8]]` so default+clone are a
/// pointer copy; only an explicit override (`/** @jsx foo */`, tsconfig
/// `jsxFactory`, …) materialises an `Owned` boxed slice.
#[derive(Debug, Clone)]
pub enum MemberList {
    Static(&'static [&'static [u8]]),
    Owned(Box<[Box<[u8]>]>),
}

impl Default for MemberList {
    /// Empty static slice — used by `core::mem::take`. `Pragma::default()`
    /// sets the real `defaults::FACTORY`/`FRAGMENT` explicitly.
    #[inline]
    fn default() -> Self {
        MemberList::Static(&[])
    }
}

impl From<Box<[Box<[u8]>]>> for MemberList {
    #[inline]
    fn from(v: Box<[Box<[u8]>]>) -> Self {
        MemberList::Owned(v)
    }
}

impl MemberList {
    #[inline]
    pub fn len(&self) -> usize {
        match self {
            MemberList::Static(s) => s.len(),
            MemberList::Owned(o) => o.len(),
        }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn get(&self, i: usize) -> Option<&[u8]> {
        match self {
            MemberList::Static(s) => s.get(i).copied(),
            MemberList::Owned(o) => o.get(i).map(|b| &**b),
        }
    }

    #[inline]
    pub fn first(&self) -> Option<&[u8]> {
        self.get(0)
    }

    #[inline]
    pub fn iter(&self) -> MemberListIter<'_> {
        MemberListIter { list: self, i: 0 }
    }
}

pub struct MemberListIter<'a> {
    list: &'a MemberList,
    i: usize,
}

impl<'a> Iterator for MemberListIter<'a> {
    type Item = &'a [u8];
    #[inline]
    fn next(&mut self) -> Option<&'a [u8]> {
        let r = self.list.get(self.i)?;
        self.i += 1;
        Some(r)
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let rem = self.list.len().saturating_sub(self.i);
        (rem, Some(rem))
    }
}

impl<'a> ExactSizeIterator for MemberListIter<'a> {}

/// Port of `options.JSX.ImportSource` (options.zig:1208).
///
/// Zig stores `[]const u8` borrowing `Defaults.ImportSourceDev`/`ImportSource`;
/// `Cow::Borrowed` matches that (zero-alloc default/clone), `Cow::Owned` covers
/// the `set_import_source()` override path.
#[derive(Debug, Clone)]
pub struct ImportSource {
    pub development: Cow<'static, [u8]>,
    pub production: Cow<'static, [u8]>,
}

impl Default for ImportSource {
    #[inline]
    fn default() -> Self {
        ImportSource {
            development: Cow::Borrowed(defaults::IMPORT_SOURCE_DEV),
            production: Cow::Borrowed(defaults::IMPORT_SOURCE),
        }
    }
}

/// Port of `options.JSX.Pragma` (options.zig:1192).
///
/// All string fields default to borrowed `'static` data (matching Zig's
/// `Defaults.*` slice initialisers), so `Pragma::default()` and the derived
/// `Clone` perform **zero** heap allocations in the common case. Hot callers
/// — `RuntimeTranspilerStore` (per transpiled module) and `Resolver`
/// (per resolve) — clone this struct on every operation.
#[derive(Debug, Clone)]
pub struct Pragma {
    // these need to be arrays
    // Zig: `[]const string` — either the static `Defaults.Factory` or a
    // heap slice from `memberListToComponentsIfDifferent`.
    pub factory: MemberList,
    pub fragment: MemberList,
    pub runtime: Runtime,
    pub import_source: ImportSource,

    /// Facilitates automatic JSX importing
    /// Set on a per file basis like this:
    /// /** @jsxImportSource @emotion/core */
    pub classic_import_source: Cow<'static, [u8]>,
    pub package_name: Cow<'static, [u8]>,

    /// Configuration Priority:
    /// - `--define=process.env.NODE_ENV=...`
    /// - `NODE_ENV=...`
    /// - tsconfig.json's `compilerOptions.jsx` (`react-jsx` or `react-jsxdev`)
    pub development: bool,
    pub parse: bool,
    pub side_effects: bool,
}

impl Default for Pragma {
    #[inline]
    fn default() -> Self {
        Pragma {
            factory: MemberList::Static(defaults::FACTORY),
            fragment: MemberList::Static(defaults::FRAGMENT),
            runtime: Runtime::Automatic,
            import_source: ImportSource::default(),
            classic_import_source: Cow::Borrowed(b"react"),
            package_name: Cow::Borrowed(b"react"),
            development: true,
            parse: true,
            side_effects: false,
        }
    }
}

impl Pragma {
    pub fn hash_for_runtime_transpiler(&self, hasher: &mut bun_wyhash::Wyhash) {
        // PORT NOTE: spec options.zig:1213 takes `*std.hash.Wyhash`, which is the
        // algorithm behind `bun.hash` — distinct from `bun.Wyhash11`. Using
        // `Wyhash11` would yield a different cache key than the Zig path.
        for factory in self.factory.iter() {
            hasher.update(factory);
        }
        for fragment in self.fragment.iter() {
            hasher.update(fragment);
        }
        hasher.update(&self.import_source.development);
        hasher.update(&self.import_source.production);
        hasher.update(&self.classic_import_source);
        hasher.update(&self.package_name);
    }

    pub fn import_source(&self) -> &[u8] {
        if self.development {
            &self.import_source.development
        } else {
            &self.import_source.production
        }
    }

    pub fn parse_package_name(str: &[u8]) -> &[u8] {
        if str.is_empty() {
            return str;
        }
        if str[0] == b'@' {
            if let Some(first_slash) = strings::index_of_char(&str[1..], b'/') {
                let first_slash = first_slash as usize;
                let remainder = &str[1 + first_slash + 1..];

                if let Some(last_slash) = strings::index_of_char(remainder, b'/') {
                    let last_slash = last_slash as usize;
                    return &str[0..first_slash + 1 + last_slash + 1];
                }
            }
        }

        if let Some(first_slash) = strings::index_of_char(str, b'/') {
            return &str[0..first_slash as usize];
        }

        str
    }

    pub fn is_react_like(&self) -> bool {
        &*self.package_name == b"react"
            || &*self.package_name == b"@emotion/jsx"
            || &*self.package_name == b"@emotion/react"
    }

    /// Port of `options.JSX.Pragma.setImportSource` (Zig wraps
    /// `strings.concatIfNeeded`). When `package_name` is the default
    /// `"react"`, this borrows the interned `defaults::IMPORT_SOURCE*` —
    /// matching Zig's interned-string fast path with zero allocations.
    pub fn set_import_source(&mut self) {
        self.import_source.development = Self::concat_or_interned(
            &self.package_name,
            b"/jsx-dev-runtime",
            defaults::IMPORT_SOURCE_DEV,
        );
        self.import_source.production =
            Self::concat_or_interned(&self.package_name, b"/jsx-runtime", defaults::IMPORT_SOURCE);
    }

    #[inline]
    fn concat_or_interned(
        pkg: &[u8],
        suffix: &'static [u8],
        interned: &'static [u8],
    ) -> Cow<'static, [u8]> {
        if pkg.len() + suffix.len() == interned.len()
            && &interned[..pkg.len()] == pkg
            && &interned[pkg.len()..] == suffix
        {
            return Cow::Borrowed(interned);
        }
        let mut out = Vec::with_capacity(pkg.len() + suffix.len());
        out.extend_from_slice(pkg);
        out.extend_from_slice(suffix);
        Cow::Owned(out)
    }

    pub fn set_production(&mut self, is_production: bool) {
        self.development = !is_production;
    }

    // "React.createElement" => ["React", "createElement"]
    // ...unless new is "React.createElement" and original is ["React", "createElement"]
    // saves an allocation for the majority case
    pub fn member_list_to_components_if_different(
        original: MemberList,
        new: &[u8],
    ) -> Result<MemberList, bun_core::Error> {
        let count = strings::count_char(new, b'.') + 1;

        let mut needs_alloc = false;
        let mut current_i: usize = 0;
        for str in new.split(|b| *b == b'.') {
            if str.is_empty() {
                continue;
            }
            match original.get(current_i) {
                Some(part) if part == str => current_i += 1,
                _ => {
                    needs_alloc = true;
                    break;
                }
            }
        }

        if !needs_alloc {
            return Ok(original);
        }

        let mut out: Vec<Box<[u8]>> = Vec::with_capacity(count);
        for str in new.split(|b| *b == b'.') {
            if str.is_empty() {
                continue;
            }
            out.push(Box::from(str));
        }
        Ok(MemberList::Owned(out.into_boxed_slice()))
    }

    pub fn from_api(jsx: api::Jsx) -> Result<Pragma, bun_core::Error> {
        let mut pragma = Pragma::default();

        if !jsx.fragment.is_empty() {
            pragma.fragment = Self::member_list_to_components_if_different(
                core::mem::take(&mut pragma.fragment),
                &jsx.fragment,
            )?;
        }

        if !jsx.factory.is_empty() {
            pragma.factory = Self::member_list_to_components_if_different(
                core::mem::take(&mut pragma.factory),
                &jsx.factory,
            )?;
        }

        pragma.runtime = Runtime::from(jsx.runtime);
        pragma.side_effects = jsx.side_effects;

        if !jsx.import_source.is_empty() {
            pragma.package_name = Cow::Owned(jsx.import_source.into_vec());
            pragma.set_import_source();
            pragma.classic_import_source = pragma.package_name.clone();
        }

        pragma.development = jsx.development;
        pragma.parse = true;
        Ok(pragma)
    }
}

/// Port of `options.JSX.Defaults` (options.zig).
pub mod defaults {
    pub const FACTORY: &[&[u8]] = &[b"React", b"createElement"];
    pub const FRAGMENT: &[&[u8]] = &[b"React", b"Fragment"];
    pub const IMPORT_SOURCE_DEV: &[u8] = b"react/jsx-dev-runtime";
    pub const IMPORT_SOURCE: &[u8] = b"react/jsx-runtime";
    pub const JSX_FUNCTION: &[u8] = b"jsx";
    pub const JSX_STATIC_FUNCTION: &[u8] = b"jsxs";
    pub const JSX_FUNCTION_DEV: &[u8] = b"jsxDEV";
}
pub use defaults as Defaults;
