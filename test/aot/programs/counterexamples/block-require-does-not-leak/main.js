// Behind a block's own `const m = require("./a")`, m is again the top-level `const m = require("./b")`.
{ const m = require("./a"); }
const m = require("./b");
console.log((() => { { const m = require("./a"); } return m.x; })());
