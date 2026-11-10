import * as tools from "./lib.cjs";
const names = [];
for (const name in tools) names.push(name);
console.log(names.join());
console.log(String(Object.hasOwn(tools, JSON.parse('"alpha"'))));
