// A module imports a CommonJS file, which requires a second module, which imports the first. The first has not begun while the file runs: it runs inside the require, ahead of the second. In the other three files the first module throws there: the require throws, and whoever imports the second module later gets the same error.
const outcome = (name, promise) => promise.then(() => console.log(`import(${name}) resolves`), error => console.log(`import(${name}) rejects:`, error.message));
await outcome("importer", import("./importer.mjs"));
await outcome("throwing-importer", import("./throwing-importer.mjs"));
await outcome("later", import("./later.mjs"));
