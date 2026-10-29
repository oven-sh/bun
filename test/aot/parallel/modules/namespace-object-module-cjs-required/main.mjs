// A CommonJS file requires an ES module. The namespace object of that module answers Object.isExtensible() and Object.isSealed() as every namespace object does, and nothing
// can be added to it.
import * as ns from "./plain.mjs";
import { required } from "./reader.cjs";

const hold = [ns][0];
console.log(required === ns, Object.isExtensible(ns), Object.isExtensible(hold), Reflect.isExtensible(hold));
console.log(Object.isSealed(ns), Object.isSealed(hold), Object.isFrozen(ns), Object.isFrozen(hold));
console.log(Reflect.set(hold, "added", 1), hold.added, "added" in hold, Reflect.ownKeys(hold).map(String).join());
console.log(Reflect.defineProperty(hold, "defined", { value: 2 }), hold.defined, Reflect.ownKeys(hold).map(String).join());
try {
  hold.stored = 3;
  console.log("stored", hold.stored);
} catch (error) {
  console.log(error.name);
}
console.log(Reflect.preventExtensions(hold), Object.isExtensible(hold), Object.isSealed(hold));
console.log(hold.__esModule, "__esModule" in hold, Object.keys(hold).join());
/* Output:
true false false false
true true false false
false undefined false p,Symbol(Symbol.toStringTag)
false undefined p,Symbol(Symbol.toStringTag)
TypeError
true false true
true true p
*/
