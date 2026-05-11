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
use bun_string::strings;

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

/// Port of `options.JSX.ImportSource` (options.zig:1208).
#[derive(Debug, Clone)]
pub struct ImportSource {
    pub development: Box<[u8]>,
    pub production: Box<[u8]>,
}

impl Default for ImportSource {
    fn default() -> Self {
        ImportSource {
            development: Box::from(defaults::IMPORT_SOURCE_DEV),
            production: Box::from(defaults::IMPORT_SOURCE),
        }
    }
}

/// Port of `options.JSX.Pragma` (options.zig:1192).
#[derive(Debug, Clone)]
pub struct Pragma {
    // these need to be arrays
    // Zig: `[]const string` — either the static `Defaults.Factory` or a
    // heap slice from `memberListToComponentsIfDifferent`. Owned here so
    // the alloc path doesn't leak (PORTING.md §Forbidden patterns).
    pub factory: Box<[Box<[u8]>]>,
    pub fragment: Box<[Box<[u8]>]>,
    pub runtime: Runtime,
    pub import_source: ImportSource,

    /// Facilitates automatic JSX importing
    /// Set on a per file basis like this:
    /// /** @jsxImportSource @emotion/core */
    pub classic_import_source: Box<[u8]>,
    pub package_name: Box<[u8]>,

    /// Configuration Priority:
    /// - `--define=process.env.NODE_ENV=...`
    /// - `NODE_ENV=...`
    /// - tsconfig.json's `compilerOptions.jsx` (`react-jsx` or `react-jsxdev`)
    pub development: bool,
    pub parse: bool,
    pub side_effects: bool,
}

impl Default for Pragma {
    fn default() -> Self {
        Pragma {
            factory: defaults::FACTORY.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
            fragment: defaults::FRAGMENT.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
            runtime: Runtime::Automatic,
            import_source: ImportSource::default(),
            classic_import_source: Box::from(b"react".as_slice()),
            package_name: Box::from(b"react".as_slice()),
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

    pub fn set_import_source(&mut self) {
        strings::concat_if_needed(
            &mut self.import_source.development,
            &[&self.package_name, b"/jsx-dev-runtime"],
            &[defaults::IMPORT_SOURCE_DEV],
        )
        .expect("unreachable");

        strings::concat_if_needed(
            &mut self.import_source.production,
            &[&self.package_name, b"/jsx-runtime"],
            &[defaults::IMPORT_SOURCE],
        )
        .expect("unreachable");
    }

    pub fn set_production(&mut self, is_production: bool) {
        self.development = !is_production;
    }

    // "React.createElement" => ["React", "createElement"]
    // ...unless new is "React.createElement" and original is ["React", "createElement"]
    // saves an allocation for the majority case
    pub fn member_list_to_components_if_different(
        original: Box<[Box<[u8]>]>,
        new: &[u8],
    ) -> Result<Box<[Box<[u8]>]>, bun_core::Error> {
        let count = strings::count_char(new, b'.') + 1;

        let mut needs_alloc = false;
        let mut current_i: usize = 0;
        for str in new.split(|b| *b == b'.') {
            if str.is_empty() {
                continue;
            }
            if current_i >= original.len() {
                needs_alloc = true;
                break;
            }

            if &*original[current_i] != str {
                needs_alloc = true;
                break;
            }
            current_i += 1;
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
        Ok(out.into_boxed_slice())
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
            pragma.package_name = jsx.import_source.clone();
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
