/// Opaque representation of a JavaScript source provider
pub const SourceProvider = opaque {
    pub fn deref(provider: *SourceProvider) void {
        bun.cpp.JSC__SourceProvider__deref(provider);
    }
};

const bun = @import("bun");
