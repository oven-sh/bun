"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

let chosen = Uint8Array;
class Bytes extends Uint8Array {
  static get [Symbol.species]() {
    return chosen;
  }
}

function mapsThenTruncates(list) {
  const mapped = list.map(x => x + 300.5);
  const n = mapped[0];
  return [n | 0, n + 1, mapped.constructor.name];
}
function slicesThenAdds(list) {
  const sliced = list.slice(0, 1);
  const n = sliced[0];
  return [n + 1, sliced.length, sliced.constructor.name];
}
function filtersThenIterates(list) {
  const seen = [];
  for (const x of list.filter(() => true)) seen.push(x);
  return seen;
}

for (let i = 0; i < 2000; i++) {
  mapsThenTruncates(Uint8Array.of(5, 6));
  slicesThenAdds(Uint8Array.of(5, 6));
  filtersThenIterates(Uint8Array.of(5, 6));
}
for (const choice of [Uint8Array, Float64Array, Int8Array, Uint8ClampedArray, BigInt64Array, Array, undefined, Uint8Array]) {
  chosen = choice;
  const label = choice === undefined ? "undefined" : choice.name;
  attempt("mapsThenTruncates, species " + label, () => mapsThenTruncates(Bytes.of(5, 6)));
  attempt("slicesThenAdds, species " + label, () => slicesThenAdds(Bytes.of(5, 6)));
  attempt("filtersThenIterates, species " + label, () => filtersThenIterates(Bytes.of(5, 6)));
  attempt("mapsThenTruncates of a plain typed array", () => mapsThenTruncates(Uint8Array.of(5, 6)));
}

let promiseSpecies = Promise;
class Tracked extends Promise {
  static get [Symbol.species]() {
    return promiseSpecies;
  }
  then(onFulfilled, onRejected) {
    log.push("Tracked.then");
    return super.then(onFulfilled, onRejected);
  }
}
class Other extends Promise {
  then(onFulfilled, onRejected) {
    log.push("Other.then");
    return super.then(onFulfilled, onRejected);
  }
}
async function awaits(promise) {
  const n = await promise.then(x => x + 1);
  return [n | 0, n + 1];
}
async function promises() {
  for (let i = 0; i < 500; i++) await awaits(Promise.resolve(7));
  for (const choice of [Promise, Other, Tracked, undefined, Promise]) {
    promiseSpecies = choice;
    log.length = 0;
    const derived = Tracked.resolve(7).then(x => x);
    const kind = derived.constructor.name;
    const value = await awaits(Tracked.resolve("7"));
    console.log("species " + (choice === undefined ? "undefined" : choice.name) + " -> " + kind + " " + show(value) + " | " + log.join(", "));
  }
}
promises();
