const lib = require("./lib.mjs");
console.log("SAID after", typeof lib.__esModule, lib.later(), lib === require("./lib.mjs"));
import("./via.mjs");
