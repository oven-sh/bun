const dep = require("./dep.ts");
console.log(Object.getPrototypeOf(dep) === Object.prototype, Object.prototype.toString.call(dep));
