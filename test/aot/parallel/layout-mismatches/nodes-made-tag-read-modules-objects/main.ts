// Starts four further entry points of the executable, one after the other, each under a name that is put together at run time. The first reads `kind`, `pos` and `flags` of nodes that come back
// from code nobody sees. The others bring objects with fields of those names into the executable: the rows of a table have a `kind`, the file streams of the library a `pos` and `flags`.
// Entry points: ./nodes-made-by-one-constructor-function.ts ./an-emitter-found-through-get-builtin-module.js ./tables-of-constant-objects-that-are-changed.ts ./sibling-classes-that-differ-in-what-stops-a-store.js
const names = ["nodes-made-by-one-constructor-function.ts", "an-emitter-found-through-get-builtin-module.js", "tables-of-constant-objects-that-are-changed.ts", "sibling-classes-that-differ-in-what-stops-a-store.js"];
for (const name of names) await import(["./", name].join(process.argv[2] ?? ""));
export {};
