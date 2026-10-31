// Loads one program after another. Each imports a package of its own in one way.
console.log("## declarations-that-do-not-parse.require.cjs");
await import("./declarations-that-do-not-parse.require.cjs");
console.log("## typescript-with-type-errors.import.ts");
await import("./typescript-with-type-errors.import.ts");
console.log("## chunk-exports-shortened-separately.required.cjs");
await import("./chunk-exports-shortened-separately.required.cjs");
console.log("## typed.clone_by_descriptors.ts");
await import("./typed.clone_by_descriptors.ts");
console.log("## wasm.sync.mjs");
await import("./wasm.sync.mjs");
console.log("## wasm.async.mjs");
await import("./wasm.async.mjs");
console.log("## members-deleted-from-options.records.ts");
await import("./members-deleted-from-options.records.ts");
console.log("## records-stored-into-members.records.ts");
await import("./records-stored-into-members.records.ts");
