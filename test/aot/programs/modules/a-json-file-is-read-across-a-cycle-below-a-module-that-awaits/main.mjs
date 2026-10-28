// The entry point awaits, and imports reader.mjs, which imports caller.mjs and is imported by it. caller.mjs runs first and has reader.mjs read data.json.
import "./reader.mjs";
await 0;
console.log("main");
