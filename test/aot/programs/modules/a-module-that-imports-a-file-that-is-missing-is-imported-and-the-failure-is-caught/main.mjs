// A package that need not be installed: a module imports it by a static import, and the program reaches that module only by a load that it guards. The build goes through, and the load fails as in plain Bun.
// What is missing is a file beside the importer.
const say = e => console.log(e.name, e.code, e.specifier);
await import("./relative.mjs").catch(say);
console.log("goes on");
