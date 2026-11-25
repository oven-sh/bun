import * as seen from "./lib.js";
console.log("an importer sees [" + Object.keys(seen).sort().join() + "]");
