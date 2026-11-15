const imported = await import("./plain.cjs");
const required = import.meta.require("./plain.cjs");
console.log(Object.keys(imported), required.__esModule, required === import.meta.require("./plain.cjs"));
console.log(imported === (await import("./plain.cjs")));
