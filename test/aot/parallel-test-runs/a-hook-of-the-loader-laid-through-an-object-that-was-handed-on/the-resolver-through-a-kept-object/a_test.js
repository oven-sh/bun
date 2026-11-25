const { test } = require("bun:test");
const kept = { loader: require("node:module") };
const original = kept.loader._resolveFilename;
for (const name of Object.keys(kept)) kept[name]._resolveFilename = function (request, ...rest) { return original.call(this, request === "./dep" ? "./other" : request, ...rest); };
const dep = require("./dep");
test("the constant require asks the hook", () => { console.log("SAID", dep); });
