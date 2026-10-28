// import() loads reader.mjs, which imports caller.mjs and is imported by it. caller.mjs runs first and has reader.mjs read data.json.
await import("./reader.mjs");
console.log("main");
