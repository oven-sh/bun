(globalThis.ran ??= []).push("lib");
const { d } = require("./dep.cjs");
exports.a = "real a";
exports.seen = () => d;
