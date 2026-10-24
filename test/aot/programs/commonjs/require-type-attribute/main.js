// require(path, { type }) with a computed path asks for the file, not for the compiled module at that path, so the module does not run. Without the attribute the same kind of path runs the compiled module.
// `bun run` answers the text of the file. An executable does not hold that text, and the call throws.
globalThis.evaluated = [];

const computed = name => "./" + name;

function compileBoth() {
  require("./with-attribute.cjs");
  require("./without-attribute.cjs");
}

const exported = require(computed("without-attribute.cjs"));
console.log("without an attribute:", typeof exported, exported.name, "evaluated:", globalThis.evaluated.join());

try {
  require(computed("with-attribute.cjs"), { type: "text" });
} catch {}
console.log("with an attribute: evaluated:", globalThis.evaluated.join());
console.log(typeof compileBoth);
