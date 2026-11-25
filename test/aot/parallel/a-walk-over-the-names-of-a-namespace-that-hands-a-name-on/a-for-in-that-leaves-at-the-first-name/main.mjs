import * as kit from "./tools.mjs";
function isEmpty(o) { for (const k in o) return false; return true; }
console.log("SAID", isEmpty(kit));
