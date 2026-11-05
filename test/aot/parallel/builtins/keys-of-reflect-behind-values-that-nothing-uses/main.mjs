// The own keys of Reflect behind reads at the top level of two files whose values nothing uses. It lists a member from when it is first read:
// a variable, a field or an export takes its value whether or not anything uses it, and of a statement that is only an expression nothing is read.
import { used } from "./exports.mjs";
const variable = Reflect.set;
class Fields {
  static field = Reflect.has;
}
var list = [Reflect.get];
let literal = { member: Reflect.apply };
const kind = typeof Reflect.ownKeys;
const underKey = Reflect["construct"];
const map = new Map([[1, Reflect.isExtensible]]);
const text = /* @__PURE__ */ String(Reflect.getPrototypeOf);
const first = Reflect.setPrototypeOf,
  second = first;
Reflect.deleteProperty;
[Reflect.preventExtensions];
Object.entries(Reflect);
console.log(used, Reflect.ownKeys(Reflect).map(String).join());
