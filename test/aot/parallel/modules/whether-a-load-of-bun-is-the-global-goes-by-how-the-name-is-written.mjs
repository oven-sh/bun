// `Bun` stands in place of `import("bun")` where the transpiler reads the name: a literal, a text in backticks, a sum of texts.
// Everywhere else the module is loaded, and the answer is a namespace object whose default is Bun. That holds for the name of a constant too: it is read when the code runs, as the language says.
// `bun run` prints the value of a constant in place of its name where nothing but declarations of constants stands in front of it, and so did executables before: `[object Bun] false true` on the five lines of `first`, `later` and `name`.
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
/* Output:
awaited, a literal: [object Bun] false true
awaited, backticks: [object Bun] false true
awaited, a sum: [object Bun] false true
awaited, the first constant: [object Module] true false
awaited, a later constant: [object Module] true false
awaited, a variable: [object Module] true false
then, a literal: [object Bun] false true
then, a sum: [object Bun] false true
then, the first constant: [object Module] true false
then, a later constant: [object Module] true false
then, a variable: [object Module] true false
in a function, its first constant: [object Module] true false
in a function, a later constant: [object Module] true false
require, a later constant: [object Bun] false true
*/
