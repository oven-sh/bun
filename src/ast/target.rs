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

    pub fn default_main_fields(self) -> &'static [&'static str] {
        const NODE: &[&str] = &[Target::MAIN_FIELD_NAMES[2], Target::MAIN_FIELD_NAMES[1]];
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
