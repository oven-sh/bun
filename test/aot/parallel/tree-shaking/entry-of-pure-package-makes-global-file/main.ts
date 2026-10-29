// The entry of a package for Node makes a global that the file behind it reads as a free name, and hands on every name of that file with `export *`; the package says "sideEffects": false. The importer is loaded by import(), as a server loads its renderer.
const { page } = await import("./page.ts");
console.log(page());
