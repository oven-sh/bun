const { createRequire } = require("node:module");
let kept;
function keep(loader) {
  kept = loader;
}
keep(require);
require = createRequire(__filename);
console.log(kept === require, typeof kept, typeof require);
