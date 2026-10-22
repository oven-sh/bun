// A parameter named `require`, a parameter named `exports`, a local `module` and an `exports` declared in a block are ordinary variables: a call is no require, and a store exports nothing.
const shadows = require("./shadows.cjs");
console.log(shadows.results, shadows.fromTheBlock, Object.keys(shadows).join());
