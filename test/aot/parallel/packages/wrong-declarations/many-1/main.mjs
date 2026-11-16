// Loads one program after another. Each imports a package of its own in one way.
console.log("## commonjs.num_is_string.ts");
await import("./commonjs.num_is_string.ts");
console.log("## esm.num_is_undefined.ts");
await import("./esm.num_is_undefined.ts");
