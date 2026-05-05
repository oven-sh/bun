// GENERATED: re-run peechy (src/api/schema.peechy) with .rs output
// source: src/options_types/schema.zig (3224 lines)
// PORT STATUS: skipped — generated file (see PORTING.md §Don't translate)
//
// B-2: minimal hand-stubbed `api` namespace so Context.rs / BundleEnums.rs
// struct fields type-check. Full body arrives when peechy emits .rs.
pub mod api {
    /// schema.zig:1172 — `enum(u32)`
    #[repr(u32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum DotEnvBehavior {
        #[default]
        _none,
        disable,
        prefix,
        load_all,
        load_all_without_inlining,
    }

    /// schema.zig:1639 — opaque until peechy codegen lands.
    #[derive(Default, Debug)]
    pub struct TransformOptions {
        _opaque: (), // TODO(b2): peechy-generated fields
    }

    /// schema.zig:2973 — opaque until peechy codegen lands.
    #[derive(Default, Debug)]
    pub struct BunInstall {
        _opaque: (), // TODO(b2): peechy-generated fields
    }
}
