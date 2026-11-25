import * as kit from "./tools.mjs";
const names = [];
for (const k in kit) names.push(k);
console.log("SAID", names.map(k => k + "=" + kit[k]).join(" "));
