// Reads by name and by key through globalThis follow every change of the global object: a property that is replaced, deleted, added, turned into an accessor and back, or that hides an inherited one.
const trips = JSON.parse("50");
const keys = JSON.parse('["shared", "hasOwnProperty", "missing"]');

function read(n) { let last; for (let i = 0; i < n; i++) last = globalThis.shared; return last; }
function readByKey(key, n) { let last; for (let i = 0; i < n; i++) last = globalThis[key]; return last; }
function test(n) { let count = 0; for (let i = 0; i < n; i++) if (globalThis.shared) count++; return count; }
function has(n) { let count = 0; for (let i = 0; i < n; i++) if ("shared" in globalThis) count++; return count; }
function hasOwn(n) { let count = 0; for (let i = 0; i < n; i++) if (Object.hasOwn(globalThis, "shared")) count++; return count; }
function hasOwnByKey(key, n) { let count = 0; for (let i = 0; i < n; i++) if (Object.prototype.hasOwnProperty.call(globalThis, key)) count++; return count; }
function call(n) { let sum = 0; for (let i = 0; i < n; i++) sum += globalThis.shared(i); return sum; }
function kind(n) { let last; for (let i = 0; i < n; i++) last = typeof globalThis.shared; return last; }

function say(what) {
  console.log(what + ": " + [read(trips), readByKey(keys[0], trips), test(trips), has(trips), hasOwn(trips), hasOwnByKey(keys[0], trips), kind(trips)].join(" "));
}

say("absent");
globalThis.shared = 7;
say("added");
globalThis.shared = 0;
say("replaced");
delete globalThis.shared;
say("deleted");
globalThis[keys[0]] = "text";
say("added by key");

let reads = 0;
Object.defineProperty(globalThis, "shared", { get() { return ++reads; }, configurable: true });
say("getter");
console.log("the getter ran " + reads + " times");
Object.defineProperty(globalThis, "shared", { get() { Object.defineProperty(globalThis, "shared", { value: 10, writable: true, configurable: true }); return -10; }, configurable: true });
console.log("a getter that replaces itself: " + read(1) + " " + read(trips));
Object.defineProperty(globalThis, "shared", { value: 11, writable: false, enumerable: false, configurable: true });
say("read-only");

Object.defineProperty(globalThis, "shared", { value: function (i) { return this === globalThis ? i : -1; }, writable: true, configurable: true });
console.log("called: " + call(trips));
delete globalThis.shared;

console.log("inherited: " + (readByKey(keys[1], trips) === Object.prototype.hasOwnProperty) + " " + hasOwnByKey(keys[1], trips));
console.log("never there: " + readByKey(keys[2], trips) + " " + hasOwnByKey(keys[2], trips));
globalThis.missing = 1;
console.log("there now: " + readByKey(keys[2], trips) + " " + hasOwnByKey(keys[2], trips));
delete globalThis.missing;

const below = Object.create(globalThis);
function readBelow(n) { let last; for (let i = 0; i < n; i++) last = below.shared; return last; }
function hasOwnBelow(n) { let count = 0; for (let i = 0; i < n; i++) if (Object.hasOwn(below, "shared")) count++; return count; }
console.log("below globalThis: " + readBelow(trips) + " " + hasOwnBelow(trips));
globalThis.shared = 12;
console.log("below globalThis, added above: " + readBelow(trips) + " " + hasOwnBelow(trips));
below.shared = 13;
console.log("below globalThis, added below: " + readBelow(trips) + " " + hasOwnBelow(trips) + " " + read(trips));
