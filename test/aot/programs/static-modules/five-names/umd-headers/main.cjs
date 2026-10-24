// The header of a UMD file: `typeof exports === "object" && typeof module !== "undefined"` picks the CommonJS arm.
const umd = require("./umd.js");
console.log(umd.kind, umd.add(1, 2));
