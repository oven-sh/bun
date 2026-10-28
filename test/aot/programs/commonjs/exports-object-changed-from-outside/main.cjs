// Other modules store into, delete from, redefine, freeze and re-parent the exports object of a compiled CommonJS module, and the module itself sees every change. filled.cjs creates its names with stores; defined.cjs defines a marker, accessors, a hidden and a fixed name.
"use strict";
const { describe, show } = require("../describe-object.cjs");
const { loadFilled, loadDefined, loaded, changeFilledQuietly, changeDefinedQuietly } = require("./target.cjs");

function attempt(label, action) {
  try {
    console.log(label, show(action()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

const stored = loadFilled("stored");
console.log("in the cache", require.cache[require.resolve("./filled.cjs")].exports === stored, require("./filled.cjs") === stored);
stored.first = "replaced";
stored.added = "added";
stored["computed" + 1] = "computed";
stored[Symbol.for("outside")] = "symbol";
stored[3] = "index";
describe("stored into", stored);
console.log("the module reads", stored.read());
stored.addLate();
stored.last = "last";
describe("the module adds a name after those from outside", stored);

const deleted = loadFilled("deleted");
attempt("delete first", () => delete deleted.first);
attempt("delete absent", () => delete deleted.absent);
attempt("delete a name the module stores later", () => delete deleted.late);
describe("deleted from", deleted);
console.log("the module reads", deleted.read());
deleted.first = "back";
deleted.refill();
describe("filled again", deleted);
for (const key of Object.keys(deleted)) if (typeof deleted[key] !== "function") delete deleted[key];
describe("only the functions are left", deleted);
deleted.third = "third comes first";
deleted.refill();
deleted.label = "deleted";
describe("stored in another order", deleted);

const walked = loadFilled("walked");
const visited = [];
for (const key in walked) {
  visited.push(key);
  if (key === "first") {
    delete walked.third;
    walked.addedOnTheWay = true;
  }
}
console.log("visited", visited.join());

const redefined = loadFilled("redefined");
let reads = 0;
Object.defineProperty(redefined, "first", { configurable: true, enumerable: true, get: () => `read ${++reads}` });
Object.defineProperty(redefined, "second", { value: "fixed", writable: false });
Object.defineProperty(redefined, "third", { enumerable: false });
describe("redefined", redefined);
console.log("the module reads", redefined.read());
attempt("the module stores", () => redefined.refill());
describe("after the stores", redefined);
Object.defineProperty(redefined, "first", { value: "data again", writable: true, enumerable: true, configurable: true });
console.log("the module reads", redefined.read());
Object.defineProperty(redefined, "second", { writable: true });
Object.defineProperty(redefined, "third", { enumerable: true });
describe("every name has its first form again", redefined);
attempt("the module stores", () => redefined.refill());
console.log("the module reads", redefined.read());

const kept = loadFilled("kept");
Object.defineProperty(kept, "first", { value: "defined" });
Object.defineProperty(kept, "second", {});
Object.defineProperty(kept, "third", { value: kept.third, writable: true, enumerable: true, configurable: true });
Object.defineProperty(kept, "late", { value: "defined early", writable: true, enumerable: true, configurable: true });
describe("defined with the form that a store gives", kept);
kept.addLate();
console.log("the module reads", kept.read());

const early = loadFilled("early");
Object.defineProperty(early, "late", {
  configurable: true,
  set(value) {
    console.log("own setter got", value, this === early);
  },
});
attempt("the module adds", () => early.addLate());
describe("a setter under a name the module stores later", early);
Object.defineProperty(early, "late", { value: "fixed" });
attempt("the module adds", () => early.addLate());
describe("a fixed value under that name", early);

const functions = loadFilled("functions");
const refill = functions.refill;
functions.read = 5;
attempt("delete a function", () => delete functions.addLate);
Object.defineProperty(functions, "refill", { enumerable: false });
console.log(functions.refill === refill, Object.getOwnPropertyDescriptor(functions, "refill").value === refill, functions.read, functions.addLate);
console.log(refill(), functions.first);
describe("functions replaced, deleted and hidden", functions);

const assigned = loadFilled("assigned");
Object.assign(assigned, { second: "assigned", added: "assigned", late: "assigned" });
Object.defineProperties(assigned, { third: { value: "defined", enumerable: false }, alsoAdded: { value: "defined", enumerable: true } });
attempt("Reflect.set", () => Reflect.set(assigned, "first", "set"));
attempt("Reflect.set for another receiver", () => {
  const receiver = {};
  return [Reflect.set(assigned, "first", "for the receiver", receiver), receiver.first, assigned.first];
});
attempt("Reflect.defineProperty", () => Reflect.defineProperty(assigned, "label", { value: "reflected", writable: false }));
attempt("Reflect.set of a fixed name", () => Reflect.set(assigned, "label", "refused"));
attempt("Reflect.deleteProperty", () => Reflect.deleteProperty(assigned, "second"));
assigned.__defineGetter__("second", function () {
  return this === assigned ? "getter called on the exports object" : "getter called on another object";
});
console.log(typeof assigned.__lookupGetter__("second"), assigned.__lookupGetter__("first"), assigned.second);
describe("changed by built-ins", assigned);

const crowded = loadFilled("crowded");
for (let index = 0; index < 100; index++) crowded["extra" + index] = index;
crowded.addLate();
for (let index = 0; index < 100; index += 2) delete crowded["extra" + index];
console.log("crowded", Object.keys(crowded).length, Object.keys(crowded).slice(0, 12).join(), Object.keys(crowded).at(-1), crowded.extra99, crowded.read());

for (const integrity of ["preventExtensions", "seal", "freeze"]) {
  const object = loadFilled(integrity);
  Object[integrity](object);
  attempt(`${integrity}: store`, () => (object.first = "stored"));
  attempt(`${integrity}: add`, () => (object.added = "added"));
  attempt(`${integrity}: delete`, () => delete object.second);
  attempt(`${integrity}: define`, () => Object.defineProperty(object, "third", { enumerable: false }) === object);
  attempt(`${integrity}: define what it has`, () => Object.defineProperty(object, "label", { value: integrity }) === object);
  attempt(`${integrity}: fix a name`, () => Object.defineProperty(object, "label", { writable: false }) === object);
  attempt(`${integrity}: another prototype`, () => Object.setPrototypeOf(object, {}) === object);
  attempt(`${integrity}: the same prototype`, () => Object.setPrototypeOf(object, Object.prototype) === object);
  attempt(`${integrity}: the module stores`, () => object.refill());
  attempt(`${integrity}: the module adds`, () => object.addLate());
  attempt(`${integrity}: sloppy code`, () => changeFilledQuietly(object));
  describe(integrity, object);
}

const emptied = loadFilled("emptied");
Object.preventExtensions(emptied);
for (const key of Reflect.ownKeys(emptied)) delete emptied[key];
describe("not extensible and emptied", emptied);

const oneByOne = loadFilled("one by one");
for (const key of Reflect.ownKeys(oneByOne)) Object.defineProperty(oneByOne, key, { configurable: false, writable: false });
console.log("still extensible", Object.isSealed(oneByOne), Object.isFrozen(oneByOne));
Object.preventExtensions(oneByOne);
describe("fixed name by name", oneByOne);

const fixedLater = loadFilled("fixed later");
Object.preventExtensions(fixedLater);
for (const key of Reflect.ownKeys(fixedLater)) Object.defineProperty(fixedLater, key, { configurable: false, writable: false });
describe("not extensible, then fixed name by name", fixedLater);

const parented = loadFilled("parented");
Object.setPrototypeOf(parented, {
  inherited: "from the new prototype",
  set late(value) {
    console.log("setter of the prototype got", value, this === parented);
  },
  get absentHere() {
    return "getter of the prototype";
  },
});
console.log(parented.inherited, parented.absentHere, parented.first, "toString" in parented);
parented.addLate();
describe("parented", parented);
Object.setPrototypeOf(parented, null);
console.log(Object.getPrototypeOf(parented), parented.first, parented.toString);
parented.addLate();
describe("without a prototype", parented);

const prototypes = [
  ["a value", { late: "on the prototype" }],
  ["a fixed value", Object.freeze({ late: "fixed on the prototype" })],
  [
    "a getter alone",
    {
      get late() {
        return "from the getter of the prototype";
      },
    },
  ],
];
for (const [kind, prototype] of prototypes) {
  const shadowing = loadFilled(kind);
  Object.setPrototypeOf(shadowing, prototype);
  console.log(`${kind}: before the store`, shadowing.late, Object.hasOwn(shadowing, "late"), shadowing.read());
  attempt(`${kind}: the module adds`, () => shadowing.addLate());
  console.log(`${kind}: after the store`, shadowing.late, Object.hasOwn(shadowing, "late"), Object.keys(shadowing).includes("late"));
}

const trapped = loadFilled("trapped");
const traps = [];
Object.setPrototypeOf(
  trapped,
  new Proxy(
    {},
    {
      get(target, key, receiver) {
        traps.push(`get ${String(key)} ${receiver === trapped}`);
        return undefined;
      },
      set(target, key, value, receiver) {
        traps.push(`set ${String(key)} ${receiver === trapped}`);
        return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true });
      },
      has(target, key) {
        traps.push(`has ${String(key)}`);
        return false;
      },
    },
  ),
);
console.log("the module reads", trapped.read());
trapped.addLate();
console.log("late" in trapped, "absent" in trapped, trapped.late, Object.keys(trapped).join());
console.log(traps.join("; "));

const parent = loadFilled("parent");
const heir = Object.create(parent);
heir.first = "of the heir";
console.log(heir.first, parent.first, Object.keys(heir).join(), heir.second, heir.read());
Object.defineProperty(parent, "second", { writable: false });
attempt("store over a fixed name of the prototype", () => (heir.second = "refused"));
Object.defineProperty(parent, "third", {
  configurable: true,
  get() {
    return this === heir ? "read for the heir" : "read for the exports object";
  },
  set(value) {
    console.log("setter got", value, this === heir);
  },
});
heir.third = "through the heir";
console.log(heir.third, parent.third, Object.keys(heir).join());
parent.addLate();
console.log(heir.late, Object.hasOwn(heir, "late"));
delete parent.late;
console.log(heir.late);
describe("the prototype of another object", parent);

const defined = loadDefined("defined");
console.log("in the cache", require.cache[require.resolve("./defined.cjs")].exports === defined, require("./defined.cjs") === defined);
describe("as the module defined it", defined);
console.log("the module reads", defined.read());
attempt("store __esModule", () => (defined.__esModule = "from outside"));
attempt("store live", () => (defined.live = "from outside"));
attempt("store loose", () => (defined.loose = "from outside"));
attempt("store hidden", () => (defined.hidden = "from outside"));
attempt("store fixed", () => (defined.fixed = "from outside"));
attempt("store plain", () => (defined.plain = "from outside"));
describe("stored into, other forms", defined);
for (const name of Object.keys(defined.stores)) attempt(`the module stores ${name}`, defined.stores[name]);
console.log("the module reads", defined.read());
attempt("delete __esModule", () => delete defined.__esModule);
attempt("delete live", () => delete defined.live);
attempt("delete loose", () => delete defined.loose);
attempt("delete hidden", () => delete defined.hidden);
attempt("delete fixed", () => delete defined.fixed);
describe("deleted from, other forms", defined);
console.log("the module reads", defined.read());
defined.loose = "a value now";
defined.hidden = "listed now";
describe("stored where an accessor and a hidden name were", defined);
console.log("the module reads", defined.read());

const again = loadDefined("again");
const live = Object.getOwnPropertyDescriptor(again, "live").get;
attempt("the marker once more", () => Object.defineProperty(again, "__esModule", { value: true }) === again);
attempt("the marker with another value", () => Object.defineProperty(again, "__esModule", { value: false }));
attempt("the marker listed", () => Object.defineProperty(again, "__esModule", { enumerable: true }));
attempt("live with its getter", () => Object.defineProperty(again, "live", { get: live, enumerable: true }) === again);
attempt("live with another getter", () => Object.defineProperty(again, "live", { get() {} }));
attempt("live as a value", () => Object.defineProperty(again, "live", { value: 1 }));
attempt("loose with another getter", () => Object.defineProperty(again, "loose", { get: () => "another getter" }) === again);
again.loose = "the setter stays";
attempt("hidden listed", () => Object.defineProperty(again, "hidden", { enumerable: true }) === again);
attempt("fixed with its value", () => Object.defineProperty(again, "fixed", { value: "fixed", writable: false }) === again);
attempt("fixed made writable", () => Object.defineProperty(again, "fixed", { writable: true }));
describe("defined again", again);
attempt("loose as a value", () => Object.defineProperty(again, "loose", { value: "a value" }) === again);
attempt("store loose", () => (again.loose = "refused"));
describe("a value where an accessor was", again);
Object.defineProperty(again, "loose", { configurable: true, enumerable: true, get: () => "a getter again", set: undefined });
Object.defineProperty(again, "hidden", { enumerable: false });
describe("the first forms again", again);
console.log("the module reads", again.read());

for (const integrity of ["preventExtensions", "seal", "freeze"]) {
  const object = loadDefined(integrity);
  Object[integrity](object);
  for (const name of Object.keys(object.stores)) attempt(`${integrity}: the module stores ${name}`, object.stores[name]);
  attempt(`${integrity}: sloppy code`, () => changeDefinedQuietly(object));
  describe(`${integrity}, other forms`, object);
}

const left = loadDefined("left");
Object.preventExtensions(left);
for (const key of Reflect.ownKeys(left)) Reflect.deleteProperty(left, key);
describe("not extensible, and what cannot be deleted is left", left);

const definedParent = loadDefined("parent");
const definedHeir = Object.create(definedParent);
attempt("heir: store over the marker", () => (definedHeir.__esModule = false));
attempt("heir: store over live", () => (definedHeir.live = "refused"));
attempt("heir: store over loose", () => (definedHeir.loose = "from the heir"));
attempt("heir: store over hidden", () => (definedHeir.hidden = "of the heir"));
attempt("heir: store over fixed", () => (definedHeir.fixed = "refused"));
console.log(definedHeir.live, definedHeir.loose, definedParent.hidden, Object.keys(definedHeir).join());
console.log(Reflect.get(definedParent, "live", {}), Reflect.get(definedParent, "live"), Reflect.set(definedParent, "loose", "set", {}), definedParent.loose);

function probe(object) {
  return [object.label, object.first, object.second, object.late, object.plain, "first" in object, Object.hasOwn(object, "late")].map(show).join();
}
for (const object of [...loaded, heir, definedHeir, {}, { first: "of a literal" }]) console.log("probe", probe(object));
