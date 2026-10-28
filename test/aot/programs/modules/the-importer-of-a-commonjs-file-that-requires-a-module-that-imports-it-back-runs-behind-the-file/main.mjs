// This module imports a module and a CommonJS file. The file requires a module that imports the file back. This module runs when the file has ended. Plain Bun prints another output.
import "./other.mjs";
import "./file.cjs";
console.log("main runs");
