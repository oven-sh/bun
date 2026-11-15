import * as outer from "./outer.mjs";
const key = process.argv.length > 99 ? "none" : "twice";
console.log("SAID", outer[key]("a"));
