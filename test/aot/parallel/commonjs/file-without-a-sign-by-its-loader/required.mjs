import "./imported-by-required.cjs";
console.log("required.mjs", (function () { return typeof this; })());
