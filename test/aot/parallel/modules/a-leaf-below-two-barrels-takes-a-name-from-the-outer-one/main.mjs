import * as outer from "./outer.mjs";
import * as inner from "./inner.mjs";
const name = process.argv[2] ?? "format";
console.log("SAID", outer[name], inner[name], Object.keys(outer).join());
