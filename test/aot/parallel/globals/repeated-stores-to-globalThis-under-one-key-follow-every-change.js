import vm from "node:vm";

const holder = process.argv.length > 50 ? {} : globalThis;
function write(base, key, value) {
  base[key] = value;
}
function strictWrite(base, key, value) {
  "use strict";
  base[key] = value;
}
function repeat(base, key, rounds = 60) {
  for (let i = 0; i < rounds; i++) write(base, key, i);
  return base[key];
}
function attempt(store, base, key, value) {
  try {
    store(base, key, value);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}

const key = ["kept", "Here"].join("");
const sameText = ["ke", "ptHere"].join("");
const symbol = Symbol("keptHere");

console.log(
  "filled",
  repeat(holder, key),
  repeat(holder, sameText),
  repeat(holder, symbol),
  globalThis.keptHere,
  keptHere,
);

Bun.gc(true);
Bun.gc(true);
let kept = 0;
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < 400; i++) {
    write(holder, key, { round, i, filler: [round, i, "text " + i] });
    write(holder, symbol, { round, i, filler: [i, round] });
  }
  Bun.gc(false);
  const garbage = [];
  for (let i = 0; i < 2000; i++) garbage.push({ i, text: "garbage " + i });
  const byKey = globalThis.keptHere,
    bySymbol = globalThis[symbol];
  if (
    byKey.round === round &&
    byKey.i === 399 &&
    byKey.filler[2] === "text 399" &&
    bySymbol.round === round &&
    bySymbol.filler[0] === 399
  )
    kept++;
}
console.log("kept over collections", kept);

let seen = "nothing";
Object.defineProperty(globalThis, key, {
  get() {
    return seen;
  },
  set(value) {
    seen = [value, this === globalThis];
  },
  configurable: true,
});
console.log("setter", JSON.stringify(repeat(holder, key)), JSON.stringify(seen));

Object.defineProperty(globalThis, key, { value: "fixed", writable: false, configurable: true });
console.log("read only", attempt(write, holder, key, 1), attempt(strictWrite, holder, key, 2), globalThis.keptHere);

Object.defineProperty(globalThis, key, { value: "open", writable: true, configurable: true, enumerable: true });
console.log("writable again", repeat(holder, key), keptHere);

delete globalThis[key];
console.log("deleted", key in globalThis, typeof keptHere);
console.log("added again", repeat(holder, key), keptHere, Object.getOwnPropertyDescriptor(globalThis, key).enumerable);

for (let i = 0; i < 40; i++) globalThis["between" + i] = i;
console.log("behind other names", repeat(holder, key), keptHere);
for (let i = 0; i < 40; i += 2) delete globalThis["between" + i];
console.log(
  "behind deletions",
  repeat(holder, key),
  keptHere,
  globalThis.between1,
  globalThis.between39,
  "between2" in globalThis,
);

const plain = {};
const below = Object.create(globalThis);
const context = vm.createContext({});
const other = vm.runInContext("globalThis", context);
for (let i = 0; i < 60; i++) {
  write(holder, key, "ours " + i);
  write(plain, key, "plain " + i);
  write(below, key, "below " + i);
  write(other, key, "theirs " + i);
}
console.log(
  "four objects",
  keptHere,
  plain.keptHere,
  below.keptHere,
  Object.hasOwn(below, key),
  other.keptHere,
  vm.runInContext("keptHere", context),
);

vm.runInThisContext("var declaredByScript = 'declared'; function readDeclared() { return declaredByScript; }");
const declared = ["declared", "ByScript"].join("");
console.log("variable of a script", repeat(holder, declared), readDeclared(), declaredByScript);

Object.freeze(globalThis[symbol]);
console.log("symbol", repeat(holder, symbol), globalThis[symbol]);
Object.defineProperty(globalThis, symbol, { value: "fixed", writable: false, configurable: true });
console.log(
  "symbol read only",
  attempt(write, holder, symbol, 1),
  attempt(strictWrite, holder, symbol, 2),
  globalThis[symbol],
);

Object.preventExtensions(globalThis);
console.log(
  "not extensible",
  repeat(holder, key),
  attempt(strictWrite, holder, ["not", "There"].join(""), 1),
  "notThere" in globalThis,
);
Object.freeze(globalThis);
console.log("frozen", attempt(write, holder, key, "late"), attempt(strictWrite, holder, key, "later"), keptHere);
