// `require` reached through a variable that holds `module`, given the names of built-in modules.
var heldModule = typeof module == "object" && module && !module.nodeType && module;
var types = (function () {
  try {
    var found = heldModule && heldModule.require && heldModule.require("util").types;
    if (found) return found;
  } catch (error) {}
})();
console.log(typeof types, types.isRegExp(/a/), types.isRegExp({}), types.isTypedArray(new Uint8Array(1)));
var load = heldModule.require;
console.log(load("node:path").join("a", "b"), load("path") === require("path"), heldModule.require("events") === require("node:events"));
["os", "node:url"].forEach(function (name) { console.log(name, typeof heldModule.require(name)); });
function Counter() { this.count = 0; }
Counter.prototype.add = function () { this.count++; return this; };
module.exports = Counter;
console.log(new Counter().add().add().count);
