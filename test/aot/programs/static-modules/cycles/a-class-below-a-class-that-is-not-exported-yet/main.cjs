// `module.exports = class Base` behind a require of the module that extends it: at that moment the base is an empty object, and the class definition throws. The same definition in a function that runs later works.
require("./base.cjs");
const derived = require("./derived.cjs");
console.log(derived.failure, new (derived.define())().name());
