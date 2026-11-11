import * as kit from "./outer.mjs";
const names = [];
for (const k in kit) names.push(k);
console.log("SAID", names.join(" "));
