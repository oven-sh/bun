// What a CommonJS file stores on process is no export of node:process for an entry point that names node:process in front of the file: the names of node:process are taken before the file runs.
import * as all from "node:process";
import "./file.cjs";
console.log("the entry point:", "custom" in all, typeof all.custom, Object.keys(all).includes("custom"));
