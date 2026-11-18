see("file");
globalThis.inner = store.run("X", () => import("./inner.mjs"));
see("file behind import()");
exports.name = "file";
