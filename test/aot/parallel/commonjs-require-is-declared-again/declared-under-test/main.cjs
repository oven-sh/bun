if (typeof require === "undefined") {
  var require = function () { return { name: "fallback" }; };
}
const path = require("node:path");
console.log(path.extname("a.b"), require("./dep.cjs").name);
