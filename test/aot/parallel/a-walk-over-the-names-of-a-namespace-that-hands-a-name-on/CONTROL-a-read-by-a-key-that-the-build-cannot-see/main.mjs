import * as kit from "./tools.mjs";
const names = [];
for (const k in kit) names.push(k);
const key = ["wi", "dth"].join("");
console.log("SAID", names.join(" "), kit[key]);
