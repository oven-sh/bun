globalThis.firstExports = exports;
exports.a = 1;
require("./replaces-for-others.cjs")(module);
exports.b = 2;
module.exports.c = 3;
function printReads(replacedBy) {
  const required = require("./by-other-code.cjs");
  console.log(`by-other-code replaced by ${replacedBy}:`, exports.a, exports.b, exports.c, "|", module.exports.a, module.exports.b, module.exports.c, "|", required === module.exports, required === exports, required.a, required.b, required.c);
}
printReads("another module");
const fromAnotherModule = module.exports;
Reflect.set(module, "exports", { a: "of Reflect.set" });
module.exports.c = 4;
printReads("Reflect.set");
Object.defineProperty(module, "exports", { value: { a: "of Object.defineProperty" } });
module.exports.c = 5;
printReads("Object.defineProperty");
Object.assign(module, { exports: fromAnotherModule });
printReads("Object.assign");
