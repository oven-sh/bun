globalThis.old = module;
globalThis.load = () => require("./kept.cjs");
throw new Error("first");
