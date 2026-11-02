// A CommonJS module that one require made by createRequire reaches under a written name and under a computed one is one module: it runs once and has one state.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import.meta.resolve("./counter.cjs"); // names the file, so it is part of the executable whatever the build makes of the two calls below
const name = ["./counter", ".cjs"].join("");
console.log(require("./counter.cjs").next(), require(name).next(), require("./counter.cjs") === require(name), globalThis.timesTheCounterRan);
