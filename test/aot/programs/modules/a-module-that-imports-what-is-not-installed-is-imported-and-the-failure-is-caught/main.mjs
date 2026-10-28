// A package that need not be installed: a module imports it by a static import, and the program reaches that module only by a load that it guards. The build goes through, and the load fails as in plain Bun.
// The import() is rejected and the program goes on.
const say = e => console.log(e.name, e.code, e.specifier);
console.log("begins");
await import("./broken.mjs").catch(say);
console.log("goes on");
