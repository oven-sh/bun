const { sum, ask } = require("./asks.cjs");
globalThis.seen = [];
(0, eval)(`
  const Module = process.getBuiltinModule("node:module");
  const original = Module._resolveFilename;
  const attempt = read => { try { return String(read()); } catch (error) { return "throws " + error.name; } };
  Module._resolveFilename = function (name, above) {
    if (name === "node:" + "path")
      seen.push(
        "typeof exports: " + attempt(() => typeof above.exports),
        "keys of exports: " + attempt(() => Object.keys(above.exports).join()),
        "a member is called: " + attempt(() => above.exports.sum("a", "b")),
      );
    return original.apply(this, arguments);
  };
`);
console.log(ask(["node:", "path"].join("")));
for (const line of seen) console.log(line);
console.log(sum(1, 2));
