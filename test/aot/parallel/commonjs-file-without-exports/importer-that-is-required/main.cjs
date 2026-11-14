const first = require("./importer.mjs");
console.log(Object.keys(first));
const second = require("./plain.cjs");
console.log(second.__esModule);
import("./plain.cjs").then(it => console.log(Object.keys(it)));
