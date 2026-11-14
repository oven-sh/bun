const pending = import("./plain.cjs");
const required = import.meta.require("./plain.cjs");
const imported = await pending;
console.log(required.__esModule, required === import.meta.require("./plain.cjs"), Object.keys(imported));
