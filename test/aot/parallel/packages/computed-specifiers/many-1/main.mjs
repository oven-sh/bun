// Loads one program after another. Each imports a package of its own in one way.
console.log("## variable.req_concat.cjs");
await import("./variable.req_concat.cjs");
console.log("## variable.imp_data_url.mjs");
await import("./variable.imp_data_url.mjs");
console.log("## variable.imp_non_string.mjs");
await import("./variable.imp_non_string.mjs");
console.log("## variable.entry_variable.ts");
await import("./variable.entry_variable.ts");
