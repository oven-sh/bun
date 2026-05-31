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

// ported from: src/jsc/config.zig
