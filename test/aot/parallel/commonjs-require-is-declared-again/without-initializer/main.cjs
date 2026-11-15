console.log(typeof require, require("./dep.cjs").name);
var require;
console.log(require("./dep.cjs").name, require.resolve("./dep.cjs").endsWith("dep.cjs"));
