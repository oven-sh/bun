// A function is no prototype until something inherits from it. From then on what is added to it, changed on it or taken from it is seen by
// its heirs, also where a read of the heir has found the name absent many times before.
const lines: string[] = [];
const say = (what: string, value: unknown) => lines.push(what + ": " + String(value));

function declared() {
  return 1;
}
const arrow = () => 2;
const expression = function () {
  return 3;
};
async function asynchronous() {
  return 4;
}
function* generator() {
  yield 5;
}
const holder = {
  method() {
    return 6;
  },
};
const bound = declared.bind(null);
class Plain {
  static made() {
    return 7;
  }
}
const functions: [string, Function][] = [
  ["declared", declared],
  ["arrow", arrow],
  ["expression", expression],
  ["asynchronous", asynchronous],
  ["generator", generator],
  ["method", holder.method],
  ["bound", bound],
  ["static method", Plain.made],
];

function readMany(heir: any): unknown {
  let last: unknown = "never";
  for (let i = 0; i < 200; i++) last = heir.added;
  return last;
}
function hasMany(heir: any): boolean {
  let last = true;
  for (let i = 0; i < 200; i++) last = "added" in heir;
  return last;
}

for (const [name, f] of functions) {
  const heir = Object.create(f);
  say(name + " absent", readMany(heir));
  say(name + " in", hasMany(heir));
  (f as any).added = name + "!";
  say(name + " added", readMany(heir));
  say(name + " in", hasMany(heir));
  (f as any).added = name + "?";
  say(name + " changed", readMany(heir));
  Object.defineProperty(f, "added", { get: () => name + " by a getter", configurable: true });
  say(name + " getter", readMany(heir));
  delete (f as any).added;
  say(name + " deleted", readMany(heir));
  say(name + " in", hasMany(heir));
  say(name + " name through the heir", heir.name);
  say(name + " length through the heir", heir.length);
  say(name + " is the prototype", Object.getPrototypeOf(heir) === f);
  say(name + " isPrototypeOf", Object.prototype.isPrototypeOf.call(f, heir));
}

function Base(this: any) {
  this.own = 1;
}
function Derived(this: any) {
  this.own = 2;
}
Object.setPrototypeOf(Derived, Base);
function staticOf(constructor: any): unknown {
  let last: unknown;
  for (let i = 0; i < 200; i++) last = constructor.shared;
  return last;
}
say("old style, absent", staticOf(Derived));
(Base as any).shared = "of Base";
say("old style, added", staticOf(Derived));
(Derived as any).shared = "of Derived";
say("old style, shadowed", staticOf(Derived));
delete (Derived as any).shared;
say("old style, uncovered", staticOf(Derived));

const second = () => 8;
const chain = Object.create(Object.create(second));
say("two below, absent", readMany(chain));
(second as any).added = "far";
say("two below, added", readMany(chain));

const late = () => 9;
(late as any).before = "before";
const heirOfLate = Object.create(late);
say("a property from before", heirOfLate.before);
say("calls still", late());
say("own keys", Object.getOwnPropertyNames(late).sort().join());

const stored = () => 10;
const heirOfStored = Object.create(stored);
Object.defineProperty(stored, "guarded", { value: 1, writable: false, configurable: true });
let threw = "no";
try {
  (function () {
    "use strict";
    for (let i = 0; i < 50; i++) heirOfStored.guarded = 2;
  })();
} catch (error) {
  threw = (error as Error).constructor.name;
}
say("a store below a read-only property", threw);
say("nothing was added", Object.getOwnPropertyNames(heirOfStored).length);
Object.defineProperty(stored, "set", {
  set(value: unknown) {
    say("the setter ran with", value);
  },
  configurable: true,
});
heirOfStored.set = 3;
console.log(lines.join("\n"));
