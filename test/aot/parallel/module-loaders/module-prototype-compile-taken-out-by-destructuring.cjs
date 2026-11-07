// _compile and require are taken out of Module.prototype by destructuring.
const { _compile, require: inherited } = require("node:module").prototype;
console.log(typeof _compile, typeof inherited);
