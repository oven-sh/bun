import { createRequire } from "node:module";
let held = createRequire(import.meta.url);
held = name => "other " + name;
const choice = process.argv.length > 9 ? createRequire(import.meta.url) : name => "chosen " + name;
const get = createRequire => createRequire(import.meta.url);
console.log("SAID", held("./lib/part.cjs"), choice("./lib/index.cjs"), get(url => name => typeof url + " " + name)("./lib/index.cjs"));
