import { kit } from "./outer.mjs";
function look() { return typeof kit.version; }
console.log("SAID", typeof look);
