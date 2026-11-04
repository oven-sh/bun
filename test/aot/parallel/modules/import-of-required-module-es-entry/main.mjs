// An import() of the module that a require() is running settles when that module has run, also where the entry point is an ES module, so that compiled code begins the module.
process.on("exit", () => console.log("at exit:", globalThis.seen.join(" | ")));
globalThis.seen = [];
const mid = require("./mid.mjs");
seen.push("required " + Object.keys(mid).join());
import("./mid.mjs").then(it => seen.push("third " + it.value + " " + (it === globalThis.first)));
