// requires-back.cjs runs while the graph of this entry point is being loaded, and requires importer.mjs. Before that require() returns, importer.mjs runs, then the file that it imports on demand, then this module.
import "./importer.mjs";
console.log("main runs");
