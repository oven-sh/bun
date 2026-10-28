// A package that need not be installed: a module imports it by a static import, and the program reaches that module only by a load that it guards. The build goes through, and the load fails as in plain Bun.
// The importer is a TypeScript file.
const say = e => console.log(e.name, e.code, e.specifier);
await import("./typed.ts").catch(say);
console.log("goes on");
