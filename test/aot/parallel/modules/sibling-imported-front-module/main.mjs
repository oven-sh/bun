// A package that need not be installed: a module imports it by a static import, and the program reaches that module only by a load that it guards. The build goes through, and the load fails as in plain Bun.
// Nothing of the graph runs where one of its modules cannot be linked: not the sibling that stands in front of it either.
const say = e => console.log(e.name, e.code, e.specifier);
await import("./above.mjs").catch(say);
console.log("goes on");
