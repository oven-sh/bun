import { tools } from "./barrel.mjs";
let total = 0;
for (const name in tools) total += tools[name]();
console.log(total);
