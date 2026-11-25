const required = import.meta.require("./plain.cjs");
const imported = await import("./plain.cjs");
console.log(Object.keys(required), Object.keys(imported), required === import.meta.require("./plain.cjs"));
