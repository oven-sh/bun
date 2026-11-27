const dep = require("./dep.js");
console.log(Object.getPrototypeOf(dep) === Object.prototype, Object.prototype.toString.call(dep));
