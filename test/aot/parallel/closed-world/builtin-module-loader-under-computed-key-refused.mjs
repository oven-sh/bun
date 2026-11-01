// A getter on EventEmitter.prototype catches `process` when the library reads process.noDeprecation. The program then calls process.getBuiltinModule under a computed key.
// It names no module loader, so the call is refused, and the error says what to write. Plain Bun loads node:vm.
// Alone: whether a module may be loaded by name depends on what else the executable holds
// Env: NODE_NO_WARNINGS=1
import { EventEmitter } from "node:events";
import util from "node:util";
import http from "node:http";
const key = ["get", "Builtin", "Module"].join(""), name = ["node", "vm"].join(":");
let got;
let proto = Object.getPrototypeOf(http.createServer());
while (Object.getPrototypeOf(Object.getPrototypeOf(proto))) proto = Object.getPrototypeOf(proto);
console.log(proto === EventEmitter.prototype);
Object.defineProperty(proto, "noDeprecation", { get() { got = this; return false; }, configurable: true });
util.deprecate(() => {}, "x")();
console.log(got === process, typeof got[key]);
try {
  console.log(typeof got[key](name));
} catch (error) {
  console.log(error.code, error.message.replace(/ \(bun compile differs.*$/, ""));
}
/* Output:
true
true function
MODULE_NOT_FOUND Cannot load 'node:vm': this executable can't load a module from a dynamic path. The compiler couldn't tell at build time that this call reaches a module loader. Call require(), import() or process.getBuiltinModule() directly.
*/
