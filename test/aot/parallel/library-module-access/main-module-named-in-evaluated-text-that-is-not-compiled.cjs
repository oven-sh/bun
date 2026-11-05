// Only source text that the program evaluates names process.mainModule, and the text is a script of several statements or with a declaration, which is not compiled: the interpreter runs it.
// The build has read it all the same, so it finds the module object of the entry point, and through it the module of Bun that it names, as under `bun run`.
// Alone: what another program of the executable names decides what this one finds.
exports.marker = "exports of the entry point";
(0, eval)("var first = typeof process.mainModule; globalThis.seen = [first];");
(0, eval)("const held = process.mainModule; globalThis.seen.push(held.exports.marker, held.id);");
(0, eval)("globalThis.seen.push(1); globalThis.seen.push(typeof process.mainModule.require);");
(0, eval)(`let os = process.mainModule.require("node:os"); globalThis.seen.push(typeof os.EOL);`);
(0, eval)("class Reads { static found = process.mainModule === undefined } globalThis.seen.push(Reads.found);");
console.log(seen.join(" | "));
