see("file");
exports.name = "a" + process.argv.length;
globalThis.inner = store.run("inner", () => import("./inner.mjs"));
