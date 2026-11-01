// A CommonJS file queues a microtask that adds an export; the module that imports it reads the export in its body.
import whole from "./file.cjs";
console.log("the entry point runs", whole.one);
