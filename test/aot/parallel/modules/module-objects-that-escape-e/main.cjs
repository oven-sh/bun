// One file asks whether it has a parent, another calls what it hands out, and nobody reads a module's object.
const part = require("./part.cjs");
module.exports = function total(box) {
  return box.get("a") + part.length;
};
console.log(module.exports(new Map([["a", 1]])), part({ get: name => name + "2" }));
