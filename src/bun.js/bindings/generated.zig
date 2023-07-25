pub const ResolvedSourceTag = enum(u64) {
    //
    javascript = 0,
    package_json_type_module = 1,
    wasm = 2,
    object = 3,
    file = 4,
    esm = 5,
    // Built in modules are loaded through InternalModuleRegistry by numerical ID.
    // In this enum are represented as `(1 << 8) & id`

    // Native modules are loaded ... TODO, but we'll use 1024 and up
};
