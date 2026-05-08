use bun_options_types::schema::api;

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

    args.write = Some(false);
    args.resolve = Some(api::ResolveMode::Lazy);
    configure_transform_options_for_bun(args)
}

// TODO(port): narrow error set — body never errors
pub fn configure_transform_options_for_bun(
    args: api::TransformOptions,
) -> Result<api::TransformOptions, bun_core::Error> {
    let mut args = args;
    args.target = Some(api::Target::Bun);
    Ok(args)
}

// ported from: src/jsc/config.zig
