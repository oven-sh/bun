// What a constructor that only hands `this` on makes: the attributes of what is defined on it hold exactly.
const lines = [];
const show = (label, value) => lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
const attempt = (label, action) => {
  try {
    show(label, action());
  } catch (error) {
    show(label, error.constructor.name + " " + error.message);
  }
};
function describe(label, object) {
  show(label + " keys", Object.keys(object));
  show(label + " names", Object.getOwnPropertyNames(object));
  show(label + " own", Reflect.ownKeys(object).map(String));
  const walked = [];
  for (const key in object) walked.push(key);
  show(label + " for-in", walked);
  show(label + " entries", Object.entries(object));
  show(label + " json", JSON.stringify(object));
  show(label + " spread", { ...object });
  show(label + " assign", Object.assign({}, object));
  show(label + " descriptors", Object.getOwnPropertyDescriptors(object));
}
function makeKind(label, fill) {
  function Kind(options) {
    Object.defineProperty(this, "hidden", { value: { options, label }, enumerable: false });
    fill(this, options);
  }
  return Kind;
}
const Fixed = makeKind("fixed", (self, options) => {
  self.a = options.a;
  Object.defineProperty(self, "quiet", { value: options.a * 2, writable: true, configurable: true });
  Object.defineProperty(self, "loud", { value: options.a * 3, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(self, "stuck", { value: options.a * 4, enumerable: true });
  self.b = options.a + 1;
});
function strictly(object) {
  "use strict";
  attempt("strict store hidden", () => ((object.hidden = 1), object.hidden));
  attempt("strict store stuck", () => ((object.stuck = 1), object.stuck));
  attempt("strict store quiet", () => ((object.quiet = 7), object.quiet));
  attempt("strict delete hidden", () => delete object.hidden);
  attempt("strict delete stuck", () => delete object.stuck);
  attempt("strict delete quiet", () => delete object.quiet);
}
for (let turn = 0; turn < 3; turn++) {
  const made = new Fixed({ a: turn + 1 });
  describe("made " + turn, made);
  made.hidden = 5;
  made.stuck = 6;
  made.quiet += 1;
  made.loud += 1;
  show("after sloppy stores", [made.hidden.label, made.stuck, made.quiet, made.loud]);
  show("sloppy delete", [delete made.hidden, delete made.stuck, delete made.loud]);
  describe("after deletes " + turn, made);
  strictly(made);
  describe("after strict " + turn, made);
  attempt("define hidden again, same", () => Object.defineProperty(made, "hidden", { value: made.hidden }) === made);
  attempt("define hidden again, other", () => Object.defineProperty(made, "hidden", { value: 1 }) === made);
  attempt("define hidden enumerable", () => Object.defineProperty(made, "hidden", { enumerable: true }) === made);
  attempt("reflect define hidden", () => Reflect.defineProperty(made, "hidden", { value: 2 }));
  attempt("define quiet back", () => Object.defineProperty(made, "quiet", { value: 9, enumerable: true }).quiet);
  attempt("define a as getter", () => Object.defineProperty(made, "a", { get: () => "got", configurable: true }).a);
  attempt("define b read-only", () => ((Object.defineProperty(made, "b", { writable: false }).b = 100), made.b));
  describe("after definitions " + turn, made);
  show("has", ["hidden" in made, Object.hasOwn(made, "hidden"), made.propertyIsEnumerable("hidden"), made.propertyIsEnumerable("stuck"), made.hasOwnProperty("quiet")]);
  Object.freeze(made);
  show("frozen", [Object.isFrozen(made), Object.isSealed(made), Object.isExtensible(made)]);
  describe("frozen " + turn, made);
}
console.log(lines.join("\n"));
/* Output:
made 0 keys: ["a","loud","stuck","b"]
made 0 names: ["hidden","a","quiet","loud","stuck","b"]
made 0 own: ["hidden","a","quiet","loud","stuck","b"]
made 0 for-in: ["a","loud","stuck","b"]
made 0 entries: [["a",1],["loud",3],["stuck",4],["b",2]]
made 0 json: {"a":1,"loud":3,"stuck":4,"b":2}
made 0 spread: {"a":1,"loud":3,"stuck":4,"b":2}
made 0 assign: {"a":1,"loud":3,"stuck":4,"b":2}
made 0 descriptors: {"hidden":{"value":{"options":{"a":1},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":1,"writable":true,"enumerable":true,"configurable":true},"quiet":{"value":2,"writable":true,"enumerable":false,"configurable":true},"loud":{"value":3,"writable":true,"enumerable":true,"configurable":true},"stuck":{"value":4,"writable":false,"enumerable":true,"configurable":false},"b":{"value":2,"writable":true,"enumerable":true,"configurable":true}}
after sloppy stores: ["fixed",4,3,4]
sloppy delete: [false,false,true]
after deletes 0 keys: ["a","stuck","b"]
after deletes 0 names: ["hidden","a","quiet","stuck","b"]
after deletes 0 own: ["hidden","a","quiet","stuck","b"]
after deletes 0 for-in: ["a","stuck","b"]
after deletes 0 entries: [["a",1],["stuck",4],["b",2]]
after deletes 0 json: {"a":1,"stuck":4,"b":2}
after deletes 0 spread: {"a":1,"stuck":4,"b":2}
after deletes 0 assign: {"a":1,"stuck":4,"b":2}
after deletes 0 descriptors: {"hidden":{"value":{"options":{"a":1},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":1,"writable":true,"enumerable":true,"configurable":true},"quiet":{"value":3,"writable":true,"enumerable":false,"configurable":true},"stuck":{"value":4,"writable":false,"enumerable":true,"configurable":false},"b":{"value":2,"writable":true,"enumerable":true,"configurable":true}}
strict store hidden: TypeError Attempted to assign to readonly property.
strict store stuck: TypeError Attempted to assign to readonly property.
strict store quiet: 7
strict delete hidden: TypeError Unable to delete property.
strict delete stuck: TypeError Unable to delete property.
strict delete quiet: true
after strict 0 keys: ["a","stuck","b"]
after strict 0 names: ["hidden","a","stuck","b"]
after strict 0 own: ["hidden","a","stuck","b"]
after strict 0 for-in: ["a","stuck","b"]
after strict 0 entries: [["a",1],["stuck",4],["b",2]]
after strict 0 json: {"a":1,"stuck":4,"b":2}
after strict 0 spread: {"a":1,"stuck":4,"b":2}
after strict 0 assign: {"a":1,"stuck":4,"b":2}
after strict 0 descriptors: {"hidden":{"value":{"options":{"a":1},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":1,"writable":true,"enumerable":true,"configurable":true},"stuck":{"value":4,"writable":false,"enumerable":true,"configurable":false},"b":{"value":2,"writable":true,"enumerable":true,"configurable":true}}
define hidden again, same: true
define hidden again, other: TypeError Attempting to change value of a readonly property.
define hidden enumerable: TypeError Attempting to change enumerable attribute of unconfigurable property.
reflect define hidden: false
define quiet back: 9
define a as getter: got
define b read-only: 2
after definitions 0 keys: ["a","stuck","b","quiet"]
after definitions 0 names: ["hidden","a","stuck","b","quiet"]
after definitions 0 own: ["hidden","a","stuck","b","quiet"]
after definitions 0 for-in: ["a","stuck","b","quiet"]
after definitions 0 entries: [["a","got"],["stuck",4],["b",2],["quiet",9]]
after definitions 0 json: {"a":"got","stuck":4,"b":2,"quiet":9}
after definitions 0 spread: {"a":"got","stuck":4,"b":2,"quiet":9}
after definitions 0 assign: {"a":"got","stuck":4,"b":2,"quiet":9}
after definitions 0 descriptors: {"hidden":{"value":{"options":{"a":1},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"enumerable":true,"configurable":true},"stuck":{"value":4,"writable":false,"enumerable":true,"configurable":false},"b":{"value":2,"writable":false,"enumerable":true,"configurable":true},"quiet":{"value":9,"writable":false,"enumerable":true,"configurable":false}}
has: [true,true,false,true,true]
frozen: [true,true,false]
frozen 0 keys: ["a","stuck","b","quiet"]
frozen 0 names: ["hidden","a","stuck","b","quiet"]
frozen 0 own: ["hidden","a","stuck","b","quiet"]
frozen 0 for-in: ["a","stuck","b","quiet"]
frozen 0 entries: [["a","got"],["stuck",4],["b",2],["quiet",9]]
frozen 0 json: {"a":"got","stuck":4,"b":2,"quiet":9}
frozen 0 spread: {"a":"got","stuck":4,"b":2,"quiet":9}
frozen 0 assign: {"a":"got","stuck":4,"b":2,"quiet":9}
frozen 0 descriptors: {"hidden":{"value":{"options":{"a":1},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"enumerable":true,"configurable":false},"stuck":{"value":4,"writable":false,"enumerable":true,"configurable":false},"b":{"value":2,"writable":false,"enumerable":true,"configurable":false},"quiet":{"value":9,"writable":false,"enumerable":true,"configurable":false}}
made 1 keys: ["a","loud","stuck","b"]
made 1 names: ["hidden","a","quiet","loud","stuck","b"]
made 1 own: ["hidden","a","quiet","loud","stuck","b"]
made 1 for-in: ["a","loud","stuck","b"]
made 1 entries: [["a",2],["loud",6],["stuck",8],["b",3]]
made 1 json: {"a":2,"loud":6,"stuck":8,"b":3}
made 1 spread: {"a":2,"loud":6,"stuck":8,"b":3}
made 1 assign: {"a":2,"loud":6,"stuck":8,"b":3}
made 1 descriptors: {"hidden":{"value":{"options":{"a":2},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":2,"writable":true,"enumerable":true,"configurable":true},"quiet":{"value":4,"writable":true,"enumerable":false,"configurable":true},"loud":{"value":6,"writable":true,"enumerable":true,"configurable":true},"stuck":{"value":8,"writable":false,"enumerable":true,"configurable":false},"b":{"value":3,"writable":true,"enumerable":true,"configurable":true}}
after sloppy stores: ["fixed",8,5,7]
sloppy delete: [false,false,true]
after deletes 1 keys: ["a","stuck","b"]
after deletes 1 names: ["hidden","a","quiet","stuck","b"]
after deletes 1 own: ["hidden","a","quiet","stuck","b"]
after deletes 1 for-in: ["a","stuck","b"]
after deletes 1 entries: [["a",2],["stuck",8],["b",3]]
after deletes 1 json: {"a":2,"stuck":8,"b":3}
after deletes 1 spread: {"a":2,"stuck":8,"b":3}
after deletes 1 assign: {"a":2,"stuck":8,"b":3}
after deletes 1 descriptors: {"hidden":{"value":{"options":{"a":2},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":2,"writable":true,"enumerable":true,"configurable":true},"quiet":{"value":5,"writable":true,"enumerable":false,"configurable":true},"stuck":{"value":8,"writable":false,"enumerable":true,"configurable":false},"b":{"value":3,"writable":true,"enumerable":true,"configurable":true}}
strict store hidden: TypeError Attempted to assign to readonly property.
strict store stuck: TypeError Attempted to assign to readonly property.
strict store quiet: 7
strict delete hidden: TypeError Unable to delete property.
strict delete stuck: TypeError Unable to delete property.
strict delete quiet: true
after strict 1 keys: ["a","stuck","b"]
after strict 1 names: ["hidden","a","stuck","b"]
after strict 1 own: ["hidden","a","stuck","b"]
after strict 1 for-in: ["a","stuck","b"]
after strict 1 entries: [["a",2],["stuck",8],["b",3]]
after strict 1 json: {"a":2,"stuck":8,"b":3}
after strict 1 spread: {"a":2,"stuck":8,"b":3}
after strict 1 assign: {"a":2,"stuck":8,"b":3}
after strict 1 descriptors: {"hidden":{"value":{"options":{"a":2},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":2,"writable":true,"enumerable":true,"configurable":true},"stuck":{"value":8,"writable":false,"enumerable":true,"configurable":false},"b":{"value":3,"writable":true,"enumerable":true,"configurable":true}}
define hidden again, same: true
define hidden again, other: TypeError Attempting to change value of a readonly property.
define hidden enumerable: TypeError Attempting to change enumerable attribute of unconfigurable property.
reflect define hidden: false
define quiet back: 9
define a as getter: got
define b read-only: 3
after definitions 1 keys: ["a","stuck","b","quiet"]
after definitions 1 names: ["hidden","a","stuck","b","quiet"]
after definitions 1 own: ["hidden","a","stuck","b","quiet"]
after definitions 1 for-in: ["a","stuck","b","quiet"]
after definitions 1 entries: [["a","got"],["stuck",8],["b",3],["quiet",9]]
after definitions 1 json: {"a":"got","stuck":8,"b":3,"quiet":9}
after definitions 1 spread: {"a":"got","stuck":8,"b":3,"quiet":9}
after definitions 1 assign: {"a":"got","stuck":8,"b":3,"quiet":9}
after definitions 1 descriptors: {"hidden":{"value":{"options":{"a":2},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"enumerable":true,"configurable":true},"stuck":{"value":8,"writable":false,"enumerable":true,"configurable":false},"b":{"value":3,"writable":false,"enumerable":true,"configurable":true},"quiet":{"value":9,"writable":false,"enumerable":true,"configurable":false}}
has: [true,true,false,true,true]
frozen: [true,true,false]
frozen 1 keys: ["a","stuck","b","quiet"]
frozen 1 names: ["hidden","a","stuck","b","quiet"]
frozen 1 own: ["hidden","a","stuck","b","quiet"]
frozen 1 for-in: ["a","stuck","b","quiet"]
frozen 1 entries: [["a","got"],["stuck",8],["b",3],["quiet",9]]
frozen 1 json: {"a":"got","stuck":8,"b":3,"quiet":9}
frozen 1 spread: {"a":"got","stuck":8,"b":3,"quiet":9}
frozen 1 assign: {"a":"got","stuck":8,"b":3,"quiet":9}
frozen 1 descriptors: {"hidden":{"value":{"options":{"a":2},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"enumerable":true,"configurable":false},"stuck":{"value":8,"writable":false,"enumerable":true,"configurable":false},"b":{"value":3,"writable":false,"enumerable":true,"configurable":false},"quiet":{"value":9,"writable":false,"enumerable":true,"configurable":false}}
made 2 keys: ["a","loud","stuck","b"]
made 2 names: ["hidden","a","quiet","loud","stuck","b"]
made 2 own: ["hidden","a","quiet","loud","stuck","b"]
made 2 for-in: ["a","loud","stuck","b"]
made 2 entries: [["a",3],["loud",9],["stuck",12],["b",4]]
made 2 json: {"a":3,"loud":9,"stuck":12,"b":4}
made 2 spread: {"a":3,"loud":9,"stuck":12,"b":4}
made 2 assign: {"a":3,"loud":9,"stuck":12,"b":4}
made 2 descriptors: {"hidden":{"value":{"options":{"a":3},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":3,"writable":true,"enumerable":true,"configurable":true},"quiet":{"value":6,"writable":true,"enumerable":false,"configurable":true},"loud":{"value":9,"writable":true,"enumerable":true,"configurable":true},"stuck":{"value":12,"writable":false,"enumerable":true,"configurable":false},"b":{"value":4,"writable":true,"enumerable":true,"configurable":true}}
after sloppy stores: ["fixed",12,7,10]
sloppy delete: [false,false,true]
after deletes 2 keys: ["a","stuck","b"]
after deletes 2 names: ["hidden","a","quiet","stuck","b"]
after deletes 2 own: ["hidden","a","quiet","stuck","b"]
after deletes 2 for-in: ["a","stuck","b"]
after deletes 2 entries: [["a",3],["stuck",12],["b",4]]
after deletes 2 json: {"a":3,"stuck":12,"b":4}
after deletes 2 spread: {"a":3,"stuck":12,"b":4}
after deletes 2 assign: {"a":3,"stuck":12,"b":4}
after deletes 2 descriptors: {"hidden":{"value":{"options":{"a":3},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":3,"writable":true,"enumerable":true,"configurable":true},"quiet":{"value":7,"writable":true,"enumerable":false,"configurable":true},"stuck":{"value":12,"writable":false,"enumerable":true,"configurable":false},"b":{"value":4,"writable":true,"enumerable":true,"configurable":true}}
strict store hidden: TypeError Attempted to assign to readonly property.
strict store stuck: TypeError Attempted to assign to readonly property.
strict store quiet: 7
strict delete hidden: TypeError Unable to delete property.
strict delete stuck: TypeError Unable to delete property.
strict delete quiet: true
after strict 2 keys: ["a","stuck","b"]
after strict 2 names: ["hidden","a","stuck","b"]
after strict 2 own: ["hidden","a","stuck","b"]
after strict 2 for-in: ["a","stuck","b"]
after strict 2 entries: [["a",3],["stuck",12],["b",4]]
after strict 2 json: {"a":3,"stuck":12,"b":4}
after strict 2 spread: {"a":3,"stuck":12,"b":4}
after strict 2 assign: {"a":3,"stuck":12,"b":4}
after strict 2 descriptors: {"hidden":{"value":{"options":{"a":3},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"value":3,"writable":true,"enumerable":true,"configurable":true},"stuck":{"value":12,"writable":false,"enumerable":true,"configurable":false},"b":{"value":4,"writable":true,"enumerable":true,"configurable":true}}
define hidden again, same: true
define hidden again, other: TypeError Attempting to change value of a readonly property.
define hidden enumerable: TypeError Attempting to change enumerable attribute of unconfigurable property.
reflect define hidden: false
define quiet back: 9
define a as getter: got
define b read-only: 4
after definitions 2 keys: ["a","stuck","b","quiet"]
after definitions 2 names: ["hidden","a","stuck","b","quiet"]
after definitions 2 own: ["hidden","a","stuck","b","quiet"]
after definitions 2 for-in: ["a","stuck","b","quiet"]
after definitions 2 entries: [["a","got"],["stuck",12],["b",4],["quiet",9]]
after definitions 2 json: {"a":"got","stuck":12,"b":4,"quiet":9}
after definitions 2 spread: {"a":"got","stuck":12,"b":4,"quiet":9}
after definitions 2 assign: {"a":"got","stuck":12,"b":4,"quiet":9}
after definitions 2 descriptors: {"hidden":{"value":{"options":{"a":3},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"enumerable":true,"configurable":true},"stuck":{"value":12,"writable":false,"enumerable":true,"configurable":false},"b":{"value":4,"writable":false,"enumerable":true,"configurable":true},"quiet":{"value":9,"writable":false,"enumerable":true,"configurable":false}}
has: [true,true,false,true,true]
frozen: [true,true,false]
frozen 2 keys: ["a","stuck","b","quiet"]
frozen 2 names: ["hidden","a","stuck","b","quiet"]
frozen 2 own: ["hidden","a","stuck","b","quiet"]
frozen 2 for-in: ["a","stuck","b","quiet"]
frozen 2 entries: [["a","got"],["stuck",12],["b",4],["quiet",9]]
frozen 2 json: {"a":"got","stuck":12,"b":4,"quiet":9}
frozen 2 spread: {"a":"got","stuck":12,"b":4,"quiet":9}
frozen 2 assign: {"a":"got","stuck":12,"b":4,"quiet":9}
frozen 2 descriptors: {"hidden":{"value":{"options":{"a":3},"label":"fixed"},"writable":false,"enumerable":false,"configurable":false},"a":{"enumerable":true,"configurable":false},"stuck":{"value":12,"writable":false,"enumerable":true,"configurable":false},"b":{"value":4,"writable":false,"enumerable":true,"configurable":false},"quiet":{"value":9,"writable":false,"enumerable":true,"configurable":false}}
*/
