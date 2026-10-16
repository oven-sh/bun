// `module.exports` of a local `const module = require(..)` is a property of what was required.
console.log((() => { const module = require("./a"); return module.exports; })());
