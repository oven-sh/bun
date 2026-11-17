(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const maker = require("./maker.cjs");
console.log("SAID got", JSON.stringify(maker.made("./a.cjs")));
