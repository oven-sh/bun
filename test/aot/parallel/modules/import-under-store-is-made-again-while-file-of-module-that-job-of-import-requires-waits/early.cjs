see("early begins");
globalThis.leaf = store.run("held", () => import("./leaf.mjs"));
see("early ends");
exports.name = "early";
