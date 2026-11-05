// `globalThis.shelf = value` and `shelf = value`, strict and sloppy, each repeated, while the property changes under them.
const vm = require("node:vm");

const { stores: strictStores, tellAboutSymbol, tellAboutSymbolOfFrozenObject } = require("./strict-stores.cjs");

globalThis.shelf = "first";
const symbol = Symbol("shelf");
const anything = process.argv.length > 50 ? { shelf: 0 } : globalThis;
const key = ["sh", "elf"].join("");

const stores = {
  member(value) {
    globalThis.shelf = value;
  },
  free(value) {
    shelf = value;
  },
  memberOfAnything(value) {
    anything.shelf = value;
  },
  ...strictStores,
};
function storeUnderSymbol(value) {
  anything[symbol] = value;
}
function readByKey() {
  return anything[key];
}
function readFree() {
  return shelf;
}

function attempt(action, value) {
  try {
    return action(value) ?? "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
function repeat(store, value) {
  let outcome;
  for (let i = 0; i < 60; i++) outcome = attempt(store, value + " " + i);
  return outcome;
}
function tell(what) {
  for (const name in stores) {
    const outcome = repeat(stores[name], name);
    let byKey;
    for (let i = 0; i < 60; i++) byKey = attempt(readByKey);
    console.log(what + ", " + name + ":", outcome, "|", String(globalThis.shelf), "|", attempt(readFree), "|", byKey);
  }
}

tell("writable");

Bun.gc(true);
Bun.gc(true);
let kept = 0;
for (let round = 0; round < 40; round++) {
  for (const name in stores) {
    for (let i = 0; i < 100; i++) stores[name]({ round, name, i, filler: [round, i, "text " + i] });
    for (let i = 0; i < 100; i++) storeUnderSymbol({ round, name, i, filler: [i, round] });
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
      bySymbol.filler[0] === 99 &&
      readByKey() === byName
    )
      kept++;
  }
}
console.log("kept over collections", kept);

let seen = "nothing";
let calls = 0;
Object.defineProperty(globalThis, "shelf", {
  get() {
    return seen;
  },
  set(value) {
    calls++;
    seen = value + (this === globalThis || this === undefined ? "" : ", with another this");
  },
  configurable: true,
});
tell("setter");
console.log("calls of the setter", calls);

Object.defineProperty(globalThis, "shelf", { value: "fixed", writable: false, configurable: true });
tell("read only");

Object.defineProperty(globalThis, "shelf", { value: "open", writable: true, configurable: true, enumerable: true });
tell("writable again");

for (const name in stores) {
  delete globalThis.shelf;
  console.log(
    "deleted, " + name + ":",
    attempt(stores[name], "made by " + name),
    "shelf" in globalThis,
    attempt(readFree),
  );
  console.log("and then:", repeat(stores[name], name), String(globalThis.shelf), attempt(readByKey));
}
globalThis.shelf = "here again";

for (let i = 0; i < 40; i++) globalThis["between" + i] = i;
tell("behind other names");
for (let i = 0; i < 40; i += 2) delete globalThis["between" + i];
tell("behind deletions");
console.log(globalThis.between1, globalThis.between39, "between2" in globalThis);

console.log(
  "symbol",
  repeat(storeUnderSymbol, "under the symbol"),
  globalThis[symbol],
  Object.keys(globalThis).includes("shelf"),
);
let underSymbol = "nothing";
Object.defineProperty(globalThis, symbol, {
  set(value) {
    underSymbol = value;
  },
  configurable: true,
});
console.log("symbol with a setter", repeat(storeUnderSymbol, "to the setter"), underSymbol, globalThis[symbol]);
Object.defineProperty(globalThis, symbol, { value: "fixed", writable: false, configurable: true });
console.log("symbol read only", repeat(storeUnderSymbol, "ignored"), globalThis[symbol]);
delete globalThis[symbol];
console.log("symbol deleted", symbol in globalThis, repeat(storeUnderSymbol, "made again"), globalThis[symbol]);
tellAboutSymbol(repeat);

vm.runInThisContext("let shelf = 'variable of a script';");
tell("under a let of a script");
console.log("the script sees", vm.runInThisContext("shelf"), "|", globalThis.shelf);

Object.preventExtensions(globalThis);
tell("not extensible");
Object.freeze(globalThis);
tell("frozen");
console.log("symbol, frozen", repeat(storeUnderSymbol, "late"), globalThis[symbol]);
tellAboutSymbolOfFrozenObject(repeat);
