// A call through the object passes it as `this`.
const a = require("./a.cjs"),
  { who } = a;
console.log(a.who(), who());
