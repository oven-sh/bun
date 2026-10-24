// What a file without types reads as `later.x` is expected to be one of the shapes of the whole program with an `x`, those of the other modules too.
await import("./shapes.ts");
// @ts-ignore
await import("./classes.js");
// @ts-ignore
await import("./reader.js");
// @ts-ignore
await import("./namespace.js");
console.log("end");
export {};
