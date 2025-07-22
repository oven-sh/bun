/// Opaque representation of a JavaScript source provider
pub const SourceProvider = opaque {
    extern fn JSC__SourceProvider__deref(*SourceProvider) void;

    pub fn deref(provider: *SourceProvider) void {
        JSC__SourceProvider__deref(provider);
    }
};

const bun = @import("bun");
