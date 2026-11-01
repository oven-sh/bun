// A namespace object is awaited again and again.
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# namespace-object");
await import("./namespace-object/main.ts");
await settled();
console.log("# promise-of-import");
await import("./promise-of-import/main.ts");
await settled();
console.log("# awaited-four-times");
await import("./awaited-four-times/main.ts");
await settled();
