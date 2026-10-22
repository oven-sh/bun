// `arguments` at the top of a CommonJS file is the arguments object of `function (exports, require, module, __filename, __dirname) { .. }`: five arguments, which in sloppy code are one variable with the five parameters.
console.log(arguments.length);
console.log(arguments[0] === exports, arguments[1] === require, arguments[2] === module);
console.log(arguments[3] === __filename, arguments[4] === __dirname, arguments[5]);
console.log(typeof arguments, Object.prototype.toString.call(arguments), Array.isArray(arguments));
console.log(typeof arguments.callee, arguments.callee.length);

const fromArrow = (...own) => [arguments.length, own.length];
function ownObject() { return arguments.length; }
console.log(fromArrow(1, 2), ownObject(1, 2));
{
  console.log(arguments.length, (() => () => arguments[2] === module)()());
}

const firstExports = exports;
arguments[0] = "stored through the object";
console.log(exports, module.exports === firstExports);
exports = "stored to the parameter";
console.log(arguments[0]);
(() => { arguments[0] = firstExports; })();
console.log(exports === firstExports);

const firstRequire = require;
arguments[1] = (name) => "not loaded: " + name;
console.log(require("./strict.cjs"));
require = firstRequire;
console.log(arguments[1] === firstRequire);

__filename = "renamed";
console.log(arguments[3]);
delete arguments[4];
arguments[4] = "no longer mapped";
console.log(__dirname === "no longer mapped", arguments[4]);

require("./strict.cjs");
require("./redeclared.cjs");
require("./assigned.cjs");
require("./shadowed.cjs");
require("./called-again.cjs");
require("./free-name-in-module.mjs");
