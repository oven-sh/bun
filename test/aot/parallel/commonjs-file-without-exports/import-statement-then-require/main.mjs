import "./plain.cjs";
const required = import.meta.require("./plain.cjs");
console.log(required.__esModule, required === import.meta.require("./plain.cjs"));
