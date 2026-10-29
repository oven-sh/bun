// Loads one program after another. Each imports a package of its own in one way.
console.log("## elision.loud.type_used_as_type.ts");
await import("./elision.loud.type_used_as_type.ts");
console.log("## elision.loud_esm.type_used_as_type.ts");
await import("./elision.loud_esm.type_used_as_type.ts");
