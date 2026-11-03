// Loads one program after another. Each imports a package of its own in one way.
console.log("## wrapper.both.mjs");
await import("./wrapper.both.mjs");
console.log("## two-copies.both.cjs");
await import("./two-copies.both.cjs");
console.log("## live.re.mjs");
await import("./live.re.mjs");
console.log("## live.names.ts");
await import("./live.names.ts");
console.log("## live.cjs_names.mjs");
await import("./live.cjs_names.mjs");
