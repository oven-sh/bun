const vm = require("node:vm");
let calls = 0;
class Kept extends Array {
  push(...values) {
    if (++calls === 2) for (;;);
    return super.push(...values);
  }
}
module.children = new Kept();
require("./a.cjs");
globalThis.load = () => require("./b.cjs");
try { vm.runInThisContext("load()", { timeout: 500 }); } catch (error) { console.log("cut", error.code); }
require("./c.cjs");
const said = [];
for (let turn = 0; turn < 3; turn++) {
  try { said.push(module.children.length); } catch (error) { said.push("threw " + error.message); }
}
console.log("v5", said.join(" "), calls);
