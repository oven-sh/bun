// A free name that resolves to a property of the global object is read as a constant while the property keeps its value. Every way to change what the name means is seen by the next read.
const { runInThisContext } = require("node:vm");
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);

function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.name + ": " + error.message;
  }
}

globalThis.limit = 3;
function sumOfLimit(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += limit;
  return sum;
}
function kindOfLimit() {
  return typeof limit;
}
function storeLimit(value) {
  limit = value;
  return "stored";
}
// Class code is always strict. Plain Bun's transpiler drops a "use strict" directive inside a function, which would leave the reference run without a strict store.
class StrictCode {
  static storeLimit = function (value) {
    limit = value;
    return "stored";
  };
  static write = function (value) {
    written = value;
  };
}
const { storeLimit: storeLimitStrictly, write: writeStrictly } = StrictCode;
const show = label => console.log(label + ":", attempt(() => sumOfLimit(10)), kindOfLimit(), attempt(() => limit));

console.log("warm:", sumOfLimit(20000));
show("unchanged");
globalThis.limit = 4;
show("assigned through globalThis");
storeLimit(5);
show("assigned as a free name");
globalThis.limit = 5;
show("assigned the same value");
for (let i = 0; i < 40; i++) globalThis["other" + i] = i;
show("after 40 other globals");
let total = 0;
for (let i = 0; i < 200; i++) {
  globalThis.limit = i;
  total += sumOfLimit(50);
}
console.log("assigned 200 times:", total);

globalThis.holder = { id: 1, payload: new Array(64).fill(1) };
function readHolder(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += holder.id + holder.payload.length;
  return sum;
}
console.log("an object:", readHolder(20000));
const seen = [];
for (let round = 2; round < 10; round++) {
  globalThis.holder = { id: round, payload: new Array(64 + round).fill(round) };
  collect();
  const garbage = [];
  for (let i = 0; i < 2000; i++) garbage.push({ id: -1, payload: [i] });
  seen.push(readHolder(3));
}
console.log("replaced and collected before each read:", seen.join());

globalThis.settings = { name: "fixed" };
const original = globalThis.settings;
function readSettings() {
  return settings;
}
let same = 0;
for (let i = 0; i < 30000; i++) {
  if (readSettings() === original) same++;
  if (i % 10000 === 9999) collect();
}
console.log("a global that never changes:", same, readSettings().name);
runInThisContext("let unrelated = 1");
for (let i = 0; i < 30000; i++) {
  if (readSettings() === original) same++;
}
console.log("after an unrelated global let:", same, readSettings().name);

globalThis.mode = "first";
function readMode(rounds) {
  let text = "";
  for (let i = 0; i < rounds; i++) text = mode;
  return text;
}
console.log("before another global let:", readMode(20000));
runInThisContext("let alsoUnrelated = 2");
console.log("after it:", readMode(20000));
globalThis.mode = "second";
console.log("assigned after it:", readMode(10));

globalThis.written = 0;
function write(value) {
  written = value;
}
for (let i = 1; i <= 20000; i++) write(i);
console.log("a name that is only written:", globalThis.written);
let received = 0;
Object.defineProperty(globalThis, "written", { get: () => "from the getter", set: value => void (received += value), configurable: true });
for (let i = 1; i <= 10; i++) write(i);
console.log("a setter receives the stores:", received, globalThis.written);

let calls = 0;
Object.defineProperty(globalThis, "limit", { get: () => ++calls, configurable: true });
show("a getter");
console.log("getter calls:", calls);
Object.defineProperty(globalThis, "limit", { value: 7, writable: false, configurable: true });
show("read-only");
console.log("warm while read-only:", sumOfLimit(20000));
console.log("stores to it:", attempt(() => storeLimit(8)), "|", attempt(() => storeLimitStrictly(8)));
show("after the stores");
Object.defineProperty(globalThis, "limit", { value: 8 });
show("redefined");
Object.defineProperty(globalThis, "limit", { value: 8, writable: true });
console.log("warm while writable:", sumOfLimit(20000));

delete globalThis.limit;
show("deleted");
globalThis.limit = 6;
show("created again");
console.log("warm again:", sumOfLimit(20000));
delete globalThis.limit;
show("deleted again");
globalThis.limit = 8;

delete globalThis.holder;
collect();
console.log("the object is deleted and collected:", attempt(() => readHolder(1)));
globalThis.holder = { id: 100, payload: [] };
console.log("another object:", readHolder(20000));

function kindOfMissing(rounds) {
  let kind = "";
  for (let i = 0; i < rounds; i++) kind = typeof missing;
  return kind;
}
console.log("typeof an unbound name:", kindOfMissing(20000), "|", attempt(() => missing));
globalThis.missing = "here";
console.log("bound:", kindOfMissing(10), "|", attempt(() => missing));
delete globalThis.missing;
console.log("unbound again:", kindOfMissing(10), "|", attempt(() => missing));

delete globalThis.written;
console.log("a strict store to the deleted name:", attempt(() => writeStrictly(2)), "|", "written" in globalThis);
console.log("another store to it:", attempt(() => write(3)), "|", globalThis.written);
globalThis.written = 4;

runInThisContext("let limit = 9");
show("shadowed by a global let");
console.log("the property is unchanged:", globalThis.limit);
runInThisContext("limit = 10");
show("a script assigns the let");
storeLimit(11);
show("a free name assigns the let");
globalThis.limit = 12;
show("the property changes under the let");
console.log("the property:", globalThis.limit);
runInThisContext("let written = 'lexical'");
write(5);
writeStrictly(6);
console.log("a global let receives the stores:", runInThisContext("written"), globalThis.written);
