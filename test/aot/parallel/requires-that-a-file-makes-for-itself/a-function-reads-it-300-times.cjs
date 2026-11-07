const { createRequire } = require("node:module");
function current() {
  return require;
}
const first = current();
require = createRequire(__filename);
let same = 0;
for (let turn = 0; turn < 300; turn++) if (current() === first) same++;
console.log(same);
