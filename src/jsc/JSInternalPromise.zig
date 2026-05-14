// JSInternalPromise was removed from JavaScriptCore upstream. The new module
// loader uses regular JSPromise everywhere. Keep this as a transparent alias so
// existing Rust callers continue to compile.
pub const JSInternalPromise = @import("./JSPromise.rust").JSPromise;
