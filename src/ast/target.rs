//! Bundle target platform.
//!
//! Data-only enum + pure predicates. `to_api()` / `from(api::Target)` live in
//! `bun_options_types::TargetExt` (would back-edge into the schema crate).

use enum_map::Enum;

/// Defaults to `Browser`; keep `Default` so resolver can field-default it.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Hash, Enum, strum::IntoStaticStr, Default)]
pub enum Target {
    #[default]
    Browser,
    Bun,
    BunMacro,
    Node,
    /// The separate SSR graph when server-components bundling is configured
    /// with `ServerComponents.separate_ssr_graph`. Resolves like [`Target::Bun`].
    ServerComponentsSsr,
}

bun_core::comptime_string_map! {
    pub static TARGET_MAP: Target = {
        b"browser" => Target::Browser,
        b"bun" => Target::Bun,
        b"bun_macro" => Target::BunMacro,
        b"macro" => Target::BunMacro,
        b"node" => Target::Node,
    };
}

impl Target {
    /// Same lookup table as [`TARGET_MAP`] (the type is a ZST).
    pub const MAP: __ComptimeStringMap_TARGET_MAP = __ComptimeStringMap_TARGET_MAP(());

    // `from_js` lives in bundler_jsc as an extension trait — see PORTING.md.
    // `to_api`/`from(api)` live in `bun_options_types::TargetExt`.

    #[inline]
    pub fn is_server_side(self) -> bool {
        matches!(
            self,
            Target::BunMacro | Target::Node | Target::Bun | Target::ServerComponentsSsr
        )
    }

    #[inline]
    pub fn is_bun(self) -> bool {
        matches!(
            self,
            Target::BunMacro | Target::Bun | Target::ServerComponentsSsr
        )
    }

    #[inline]
    pub fn is_node(self) -> bool {
        matches!(self, Target::Node)
    }

    /// What `[target]` expands to in `--entry-naming` and friends.
    #[inline]
    pub fn naming_placeholder(self) -> &'static [u8] {
        match self {
            Target::Browser => b"browser",
            Target::Bun => b"bun",
            Target::Node => b"node",
            Target::BunMacro => b"macro",
            Target::ServerComponentsSsr => b"ssr",
        }
    }

    #[inline]
    pub fn process_browser_define_value(self) -> Option<&'static str> {
        match self {
            Target::Browser => Some("true"),
            _ => Some("false"),
        }
    }

    // `bake_graph()` stays in bun_bake (would back-edge into tier-6).
    // `out_extensions()` stays in bun_bundler (allocator-heavy, only used there).

    const MAIN_FIELD_NAMES: [&'static str; 4] = [
        "browser",
        "module",
        "main",
        // https://github.com/jsforum/jsforum/issues/5
        // Older packages might use jsnext:main in place of module
        "jsnext:main",
    ];

    /// The package.json main fields a resolver for this target reads, in order,
    /// when the user passes no `--main-fields`.
    pub fn default_main_fields(self) -> &'static [&'static str] {
        // Note that this means if a package specifies "module" and "main", the ES6
        // module will not be selected. This means tree shaking will not work when
        // targeting node environments.
        //
        // Some packages incorrectly treat the "module" field as "code for the browser". It
        // actually means "code for ES6 environments" which includes both node and the browser.
        //
        // For example, the package "@firebase/app" prints a warning on startup about
        // the bundler incorrectly using code meant for the browser if the bundler
        // selects the "module" field instead of the "main" field.
        //
        // This is unfortunate but it's a problem on the side of those packages.
        // They won't work correctly with other popular bundlers (with node as a target) anyway.
        const NODE: &[&str] = &[Target::MAIN_FIELD_NAMES[2], Target::MAIN_FIELD_NAMES[1]];
        // Note that this means if a package specifies "main", "module", and
        // "browser" then "browser" will win out over "module". This is the
        // same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
        //
        // This is deliberate because the presence of the "browser" field is a
        // good signal that this should be preferred. Some older packages might only use CJS in their "browser"
        // but in such a case they probably don't have any ESM files anyway.
        const BROWSER: &[&str] = &[
            Target::MAIN_FIELD_NAMES[0],
            Target::MAIN_FIELD_NAMES[1],
            Target::MAIN_FIELD_NAMES[3],
            Target::MAIN_FIELD_NAMES[2],
        ];
        const BUN: &[&str] = &[
            Target::MAIN_FIELD_NAMES[1],
            Target::MAIN_FIELD_NAMES[2],
            Target::MAIN_FIELD_NAMES[3],
        ];
        match self {
            Target::Node => NODE,
            Target::Browser => BROWSER,
            Target::Bun | Target::BunMacro | Target::ServerComponentsSsr => BUN,
        }
    }

    pub fn default_conditions(self) -> &'static [&'static [u8]] {
        // Callers (`ESMConditions::init`) take byte slices, so surface
        // bytes directly rather than `&str`.
        match self {
            Target::Node => &[b"node"],
            Target::Browser => &[b"browser", b"module"],
            Target::Bun => &[b"bun", b"node"],
            Target::ServerComponentsSsr => &[b"bun", b"node"],
            Target::BunMacro => &[b"macro", b"bun", b"node"],
        }
    }
}
