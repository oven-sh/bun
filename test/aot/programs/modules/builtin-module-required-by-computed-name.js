// A module of the runtime that no reachable code imports by a literal name is not in the image. Code that imports it by a computed name, and native code, still get it.
const join = (...parts) => parts.join("");
const zlib = require(join("node:", "z", "lib"));
console.log(typeof zlib.gzipSync, zlib.gunzipSync(zlib.gzipSync("abc")).toString());
const os = process.getBuiltinModule(join("o", "s"));
console.log(typeof os.EOL, typeof os.cpus);
const querystring = await import(join("node:query", "string"));
console.log(querystring.stringify({ a: 1, b: "x y" }));
const { createRequire } = require("node:module");
console.log(typeof createRequire(import.meta.url)(join("node:", "dns")).lookup);
// Native code asks for node:util to show an object.
console.log({ a: [1, { b: 2 }], c: new Map([[1, 2]]) });
process.nextTick(() => console.log("tick"));
const { setTimeout: later } = require(join("node:timers", "/promises"));
await later(1);
// Native code asks for node:timers/promises when setTimeout is promisified.
await require("node:util").promisify(setTimeout)(1);
console.log("done");
