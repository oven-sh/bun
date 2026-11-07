// Reference: bun build --compile
await import("./plain.mjs");
console.log(globalThis.seen.join(" "));
