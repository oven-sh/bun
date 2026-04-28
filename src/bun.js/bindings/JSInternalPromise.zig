// JSInternalPromise was removed from JavaScriptCore upstream. The new module
// loader uses regular JSPromise everywhere. Keep this as a transparent alias so
// existing Zig callers continue to compile.
pub const JSInternalPromise = @import("./JSPromise.zig").JSPromise;
