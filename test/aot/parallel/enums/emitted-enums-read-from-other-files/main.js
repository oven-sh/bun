// Enums as tsc emits them into .js files, exported from an ES module and from a CommonJS file, read and changed by other files, one of which is in a cycle with the enum's file.
import { describe } from "./reader.js";
import { Level, levelInside } from "./levels.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Mode, modeInside } = require("./modes.cjs");

console.log("what the cycle saw:", globalThis.seenEarly.join(" | "));
console.log(describe(), levelInside(), modeInside());
Level.High = 100;
Mode.Off = "OFF";
console.log(describe(), levelInside(), modeInside());
delete Level.Low;
delete Mode.On;
console.log(describe(), levelInside(), modeInside(), Object.keys(Level).join(), Object.keys(Mode).join());
Level.Low = -1;
Level.Extra = 7;
console.log(describe(), levelInside(), Object.keys(Level).join(), Level.Extra);
