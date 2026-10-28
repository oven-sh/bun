// A file constructs objects at its top, each by a function of its own. Each function gets another `prototype` property by another road before anybody reads its object. Every object lies below what its function had at first.
import "./changes.js";
import { Assigned, Called, Defined, Held, Keyed, Listed, Reflected, Stored, Third } from "./declared.js";
import { assigned, called, defined, held, keyed, listed, reflected, stored, third } from "./declared.js";
function second() {
  return {
    read() {
      return "second";
    },
  };
}
export function change(callable) {
  callable.prototype = second();
}
Stored.prototype = second();
Object.defineProperty(Defined, "prototype", { value: second() });
Reflect.set(Reflected, "prototype", second());
Object.assign(Assigned, { prototype: second() });
Keyed[["proto", "type"].join(process.argv.length > 99 ? "x" : "")] = second();
Held.prototype = second();
Listed.prototype = 5;
const tell = (made, maker) => `${typeof made.read} ${made instanceof maker}`;
console.log(
  tell(stored, Stored),
  tell(defined, Defined),
  tell(reflected, Reflected),
  tell(assigned, Assigned),
  tell(keyed, Keyed),
);
console.log(
  tell(held.meter, Held),
  Object.getPrototypeOf(listed[0]) === Object.prototype,
  tell(third, Third),
  tell(called, Called),
);
