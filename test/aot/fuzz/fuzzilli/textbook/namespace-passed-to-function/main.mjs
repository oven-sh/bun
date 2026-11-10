import * as tools from "./tools.mjs";
function describe(all) {
  const out = [];
  for (const key in all) out.push(key + ":" + typeof all[key]);
  return out.join();
}
console.log(describe(tools));
