// `bun run` writes `Bun` in place of `import("bun")` where its transpiler reads the name: a literal, a text in backticks, a sum of texts, a constant that stands in front of every other statement.
// Everywhere else the module is loaded, and the answer is a namespace object whose default is Bun.
const first = "bun";
const tell = (how, loaded) => console.log(how + ":", Object.prototype.toString.call(loaded), loaded.default === Bun, loaded === Bun);
const later = "bun";
let stored = "bun";
tell("awaited, a literal", await import("bun"));
tell("awaited, backticks", await import(`bun`));
tell("awaited, a sum", await import("b" + "un"));
tell("awaited, the first constant", await import(first));
tell("awaited, a later constant", await import(later));
tell("awaited, a variable", await import(stored));
await import("bun").then(loaded => tell("then, a literal", loaded));
await import("b" + "un").then(loaded => tell("then, a sum", loaded));
await import(first).then(loaded => tell("then, the first constant", loaded));
await import(later).then(loaded => tell("then, a later constant", loaded));
await import(stored).then(loaded => tell("then, a variable", loaded));
async function inside() {
  const name = "bun";
  tell("in a function, its first constant", await import(name));
  const next = "bun";
  tell("in a function, a later constant", await import(next));
}
await inside();
tell("require, a later constant", require(later));
