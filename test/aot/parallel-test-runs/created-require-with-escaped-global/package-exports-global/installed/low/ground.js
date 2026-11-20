var own = typeof self === "object" && self.Object === Object ? self : null;
var held = require("./held");

module.exports = held === null ? own || new Function("return globalThis")() : held;
