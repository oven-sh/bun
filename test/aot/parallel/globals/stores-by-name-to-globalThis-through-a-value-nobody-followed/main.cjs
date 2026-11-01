// `root.shelf = value` and `root[symbol] = value`, strict and sloppy, each repeated, where root is globalThis and the compiler can't know: the property changes under the stores.
const vm = require("node:vm");
const {
  strictStore,
  strictStoreUnderSymbol,
  readUnderStrictSymbol,
  defineUnderStrictSymbol,
} = require("./strict-stores.cjs");

const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const root = opaque(globalThis);
const symbol = Symbol("shelf");

function store(base, value) {
  base.shelf = value;
}
function storeUnderSymbol(base, value) {
  base[symbol] = value;
}
const stores = { store, strictStore };

function attempt(action, base, value) {
  try {
    action(base, value);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
function repeat(action, value, base = root) {
  let outcome;
  for (let i = 0; i < 60; i++) outcome = attempt(action, base, value + " " + i);
  return outcome;
}
function tell(what) {
  for (const name in stores) console.log(what + ", " + name + ":", repeat(stores[name], name), "|", String(root.shelf));
}

tell("added");
tell("writable");
console.log("seen as a free name", typeof shelf, shelf);

Bun.gc(true);
Bun.gc(true);
let kept = 0;
for (let round = 0; round < 40; round++) {
  for (const name in stores) {
    for (let i = 0; i < 100; i++) stores[name](root, { round, name, i, filler: [round, i, "text " + i] });
    for (let i = 0; i < 100; i++) storeUnderSymbol(root, { round, name, i, filler: [i, round] });
    Bun.gc(false);
    const garbage = [];
    for (let i = 0; i < 500; i++) garbage.push({ i, text: "garbage " + i });
    const byName = globalThis.shelf,
      bySymbol = globalThis[symbol];
    if (
      byName.round === round &&
      byName.name === name &&
      byName.filler[2] === "text 99" &&
      bySymbol.round === round &&
      bySymbol.name === name &&
      bySymbol.filler[0] === 99
    )
      kept++;
  }
}
console.log("kept over collections", kept);

let seen = "nothing";
let calls = 0;
Object.defineProperty(root, "shelf", {
  get() {
    return seen;
  },
  set(value) {
    calls++;
    seen = value + (this === globalThis ? "" : ", with another this");
  },
  configurable: true,
});
tell("setter");
console.log("calls of the setter", calls);

Object.defineProperty(root, "shelf", { value: "fixed", writable: false, configurable: true });
tell("read only");
Object.defineProperty(root, "shelf", { value: "open", writable: true, configurable: true, enumerable: true });
tell("writable again");

for (const name in stores) {
  delete root.shelf;
  console.log("deleted, " + name + ":", "shelf" in root, repeat(stores[name], "made by " + name), String(root.shelf));
}

for (let i = 0; i < 40; i++) root["between" + i] = i;
tell("behind other names");
for (let i = 0; i < 40; i += 2) delete root["between" + i];
tell("behind deletions");
console.log(root.between1, root.between39, "between2" in root);

const plain = opaque({ shelf: 0 });
const below = opaque(Object.create(globalThis));
const context = vm.createContext({});
const other = opaque(vm.runInContext("globalThis", context));
for (const name in stores) {
  for (let i = 0; i < 60; i++) {
    stores[name](root, "ours " + i);
    stores[name](plain, "plain " + i);
    stores[name](below, "below " + i);
    stores[name](other, "theirs " + i);
  }
  console.log(
    "four objects, " + name + ":",
    globalThis.shelf,
    plain.shelf,
    below.shelf,
    Object.hasOwn(below, "shelf"),
    other.shelf,
    vm.runInContext("shelf", context),
  );
  delete below.shelf;
}

vm.runInThisContext("var declaredByScript = 'declared'; function readDeclared() { return declaredByScript; }");
function storeDeclared(base, value) {
  base.declaredByScript = value;
}
console.log("variable of a script", repeat(storeDeclared, "stored"), readDeclared(), declaredByScript);

console.log("symbol", repeat(storeUnderSymbol, "under the symbol"), root[symbol]);
console.log("strict symbol", repeat(strictStoreUnderSymbol, "under the symbol"), readUnderStrictSymbol(root));
Object.defineProperty(root, symbol, { value: "fixed", writable: false, configurable: true });
defineUnderStrictSymbol(root, { value: "fixed", writable: false, configurable: true });
console.log("symbol read only", repeat(storeUnderSymbol, "ignored"), root[symbol]);
console.log("strict symbol read only", repeat(strictStoreUnderSymbol, "refused"), readUnderStrictSymbol(root));

vm.runInThisContext("let shelf = 'variable of a script';");
tell("beside a let of a script");
console.log("the script sees", vm.runInThisContext("shelf"), "|", globalThis.shelf);

Object.preventExtensions(root);
tell("not extensible");
Object.freeze(root);
tell("frozen");
