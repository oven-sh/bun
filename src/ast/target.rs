//! Bundle target platform.
//!
//! Data-only enum + pure predicates. `to_api()` / `from(api::Target)` live in
//! `bun_options_types::TargetExt` (would back-edge into the schema crate).

use bun_collections::StringHashMap;
use enum_map::{Enum, EnumMap};

/// Bake build sides/graphs. Defined here (lowest tier) so `Target::bake_graph`
/// can be inherent and so bundler/runtime share one nominal type via
/// `bun_bundler::bake_types`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, core::marker::ConstParamTy)]
pub enum Side {
    Client = 0,
    Server = 1,
}
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Graph {
    Client = 0,
    Server = 1,
    Ssr = 2,
}
/// Used for the per-file `// path (target)` comment
/// in postProcessJSChunk and friends.
impl From<Graph> for &'static str {
    fn from(g: Graph) -> Self {
        match g {
            Graph::Client => "client",
            Graph::Server => "server",
            Graph::Ssr => "ssr",
        }
    }
}
impl Side {
    pub fn graph(self) -> Graph {
        match self {
            Side::Client => Graph::Client,
            Side::Server => Graph::Server,
        }
    }
}

pub const TARGET_MAIN_FIELD_NAMES: [&[u8]; 4] = [
    b"browser",
    b"module",
    b"main",
    // https://github.com/jsforum/jsforum/issues/5
    // Older packages might use jsnext:main in place of module
    b"jsnext:main",
];

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
const DEFAULT_MAIN_FIELDS_NODE: &[&[u8]] =
    &[TARGET_MAIN_FIELD_NAMES[2], TARGET_MAIN_FIELD_NAMES[1]];

// Note that this means if a package specifies "main", "module", and
// "browser" then "browser" will win out over "module". This is the
// same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
//
// This is deliberate because the presence of the "browser" field is a
// good signal that this should be preferred. Some older packages might only use CJS in their "browser"
// but in such a case they probably don't have any ESM files anyway.
const DEFAULT_MAIN_FIELDS_BROWSER: &[&[u8]] = &[
    TARGET_MAIN_FIELD_NAMES[0],
    TARGET_MAIN_FIELD_NAMES[1],
    TARGET_MAIN_FIELD_NAMES[3],
    TARGET_MAIN_FIELD_NAMES[2],
];
const DEFAULT_MAIN_FIELDS_BUN: &[&[u8]] = &[
    TARGET_MAIN_FIELD_NAMES[1],
    TARGET_MAIN_FIELD_NAMES[2],
    TARGET_MAIN_FIELD_NAMES[3],
];

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

    pub fn bake_graph(self) -> Graph {
        match self {
            Target::Browser => Graph::Client,
            Target::ServerComponentsSsr => Graph::Ssr,
            Target::BunMacro | Target::Bun | Target::Node => Graph::Server,
        }
    }

    pub fn out_extensions(self) -> StringHashMap<&'static [u8]> {
        let mut exts = StringHashMap::<&'static [u8]>::default();

        const OUT_EXTENSIONS_LIST: &[&[u8]] = &[
            b".js", b".cjs", b".mts", b".cts", b".ts", b".tsx", b".jsx", b".json",
        ];

        if self == Target::Node {
            exts.ensure_total_capacity(OUT_EXTENSIONS_LIST.len() * 2)
                .expect("OOM");
            for &ext in OUT_EXTENSIONS_LIST {
                exts.put_static_key(ext, b".mjs").expect("OOM");
            }
        } else {
            exts.ensure_total_capacity(OUT_EXTENSIONS_LIST.len() + 1)
                .expect("OOM");
            exts.put_static_key(b".mjs", b".js").expect("OOM");
        }

        for &ext in OUT_EXTENSIONS_LIST {
            exts.put_static_key(ext, b".js").expect("OOM");
        }

        exts
    }

    // Original comment:
    // The neutral target is for people that don't want esbuild to try to
    // pick good defaults for their platform. In that case, the list of main
    // fields is empty by default. You must explicitly configure it yourself.
    // array.set(Target.neutral, &listc);
    pub fn default_main_fields_map() -> EnumMap<Target, &'static [&'static [u8]]> {
        EnumMap::from_fn(|k| match k {
            Target::Node => DEFAULT_MAIN_FIELDS_NODE,
            Target::Browser => DEFAULT_MAIN_FIELDS_BROWSER,
            Target::Bun => DEFAULT_MAIN_FIELDS_BUN,
            Target::BunMacro => DEFAULT_MAIN_FIELDS_BUN,
            Target::ServerComponentsSsr => DEFAULT_MAIN_FIELDS_BUN,
        })
    }

    pub fn default_conditions_map() -> EnumMap<Target, &'static [&'static [u8]]> {
        EnumMap::from_fn(|k| match k {
            Target::Node => &[b"node" as &[u8]][..],
            Target::Browser => &[b"browser" as &[u8], b"module"][..],
            Target::Bun => &[b"bun" as &[u8], b"node"][..],
            Target::ServerComponentsSsr => &[b"bun" as &[u8], b"node"][..],
            Target::BunMacro => &[b"macro" as &[u8], b"bun", b"node"][..],
        })
    }

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
