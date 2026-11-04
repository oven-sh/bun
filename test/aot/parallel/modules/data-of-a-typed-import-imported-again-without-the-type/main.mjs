// A data file that only an import with `{ type: "json" }` brings into the executable, imported once more by a call without the attribute, under a name made at run time.
// `bun run` keeps the two apart: two objects, and a store into one is not seen through the other.
// Todo: the call answers with the module that the attribute asked for: one object.
import typed from "./typed-alone.json" with { type: "json" };
const name = text => globalThis.never ?? text;
const untyped = (await import(name("./typed-alone.json"))).default;
console.log(untyped === typed);
untyped.n = 7;
console.log(typed.n, untyped.n, require(name("./typed-alone.json")).default.n);
