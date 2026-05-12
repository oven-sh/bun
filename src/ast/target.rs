//! `bundler/options.zig` `Target` — bundle target platform.
//!
//! Data-only enum + pure predicates. `to_api()` / `from(api::Target)` live in
//! `bun_options_types::TargetExt` (would back-edge into the schema crate).

use enum_map::Enum;
use phf;

/// Zig field default is `.browser` (`Target = .browser` in BundleOptions);
/// keep `Default` so resolver can field-default it.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Hash, Enum, strum::IntoStaticStr, Default)]
pub enum Target {
    #[default]
    Browser,
    Bun,
    BunMacro,
    Node,
    /// This is used by bake.Framework.ServerComponents.separate_ssr_graph
    BakeServerComponentsSsr,
}

impl Target {
    pub const MAP: phf::Map<&'static [u8], Target> = phf::phf_map! {
        b"browser" => Target::Browser,
        b"bun" => Target::Bun,
        b"bun_macro" => Target::BunMacro,
        b"macro" => Target::BunMacro,
        b"node" => Target::Node,
    };

    // `from_js` lives in bundler_jsc as an extension trait — see PORTING.md.
    // `to_api`/`from(api)` live in `bun_options_types::TargetExt`.

    #[inline]
    pub fn is_server_side(self) -> bool {
        matches!(
            self,
            Target::BunMacro | Target::Node | Target::Bun | Target::BakeServerComponentsSsr
        )
    }

    #[inline]
    pub fn is_bun(self) -> bool {
        matches!(
            self,
            Target::BunMacro | Target::Bun | Target::BakeServerComponentsSsr
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
        // Zig: `std.EnumArray(Target, []const string)` initialized at comptime.
        // See bundler/options.zig for the rationale comments on each ordering.
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
            Target::Bun | Target::BunMacro | Target::BakeServerComponentsSsr => BUN,
        }
    }

    pub fn default_conditions(self) -> &'static [&'static [u8]] {
        // PORT NOTE: Zig `default_conditions` is `std.EnumArray(Target, []const string)`
        // — `string` is `[]const u8`. Callers (`ESMConditions::init`) take byte
        // slices, so surface bytes directly rather than `&str`.
        match self {
            Target::Node => &[b"node"],
            Target::Browser => &[b"browser", b"module"],
            Target::Bun => &[b"bun", b"node"],
            Target::BakeServerComponentsSsr => &[b"bun", b"node"],
            Target::BunMacro => &[b"macro", b"bun", b"node"],
        }
    }
}

// ported from: src/options_types/BundleEnums.zig (Target)
