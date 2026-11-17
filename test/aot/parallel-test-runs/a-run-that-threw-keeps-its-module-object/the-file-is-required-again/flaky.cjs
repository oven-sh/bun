require("./helper.cjs");
globalThis.keep(module);
if (!globalThis.ran) { globalThis.ran = true; throw new Error("once"); }
exports.mine = module;
