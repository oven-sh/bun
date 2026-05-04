use bun_schema::api; // TODO(port): verify crate path for `bun.schema.api` (generated schema)

// PORT NOTE: Zig `DefaultBunDefines` is a namespace-only struct with nested
// namespace-only structs. Ported as nested modules; inner consts were NOT `pub`
// in the Zig source, mirrored here.
#[allow(non_snake_case, dead_code)]
pub mod DefaultBunDefines {
    #[allow(non_snake_case)]
    pub mod Keys {
        const WINDOW: &[u8] = b"window";
    }
    #[allow(non_snake_case)]
    pub mod Values {
        const WINDOW: &[u8] = b"undefined";
    }
}

// TODO(port): narrow error set — body is effectively infallible
pub fn configure_transform_options_for_bun_vm(
    args: api::TransformOptions,
) -> Result<api::TransformOptions, bun_core::Error> {
    let mut args = args;

    args.write = false;
    args.resolve = api::ResolveMode::Lazy;
    configure_transform_options_for_bun(args)
}

// TODO(port): narrow error set — body never errors
pub fn configure_transform_options_for_bun(
    args: api::TransformOptions,
) -> Result<api::TransformOptions, bun_core::Error> {
    let mut args = args;
    args.target = api::Target::Bun;
    Ok(args)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/config.zig (26 lines)
//   confidence: high
//   todos:      3
//   notes:      allocator params dropped (non-AST crate); `bun.schema.api` crate path needs Phase B verification
// ──────────────────────────────────────────────────────────────────────────
