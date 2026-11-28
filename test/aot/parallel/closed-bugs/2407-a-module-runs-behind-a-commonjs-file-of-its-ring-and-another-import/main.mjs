import "./other.mjs";
import d from "./lib.cjs";
import * as n from "./lib.cjs";
console.log("main runs", d === n.default, JSON.stringify(d), JSON.stringify(n.default));
setTimeout(() => console.log("later", d === n.default, JSON.stringify(d), JSON.stringify(n.default)));
