// `this`, `exports` and `module.exports` are objects, also where nothing but that is asked of them.
const byThis = require("./this.cjs"), byName = require("./name.cjs"), byModule = require("./module.cjs");
console.log(byThis.a, byThis.log, byThis.b, byThis.c);
console.log(byName.a, byName.log, byName.b, byName.c);
console.log(byModule.a, byModule.log, byModule.b, byModule.c);
