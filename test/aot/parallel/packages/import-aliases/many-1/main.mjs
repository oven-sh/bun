// Loads one program after another. Each imports a package of its own in one way.
console.log("## commonjs-emitted-by-typescript.function.ts");
await import("./commonjs-emitted-by-typescript.function.ts");
console.log("## re-exported.dynamic.ts");
await import("./re-exported.dynamic.ts");
console.log("## export-equals.star_import.ts");
await import("./export-equals.star_import.ts");
console.log("## es-module-in-javascript.named.ts");
await import("./es-module-in-javascript.named.ts");
