// A list of the names reads each export, as in plain Bun. A write to process behind it is not seen through the namespace.
const held = await import("node:process");
Object.keys(held);
process.features = 2;
console.log(typeof held.features, typeof process.features);
