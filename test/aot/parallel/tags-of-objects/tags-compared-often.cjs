// Object.prototype.toString.call() of values of every kind, compared with written tags again and again.
"use strict";
const toString = Object.prototype.toString, tagOf = (value) => toString.call(value);
class Tagged { get [Symbol.toStringTag]() { return this.tag ?? "Tagged"; } }
class Plain { x = 1; }
const own = { [Symbol.toStringTag]: "Own" }, changing = { [Symbol.toStringTag]: "First" }, strange = { [Symbol.toStringTag]: 1 };
const throwing = { get [Symbol.toStringTag]() { throw new Error("tag"); } };
const makers = [
  () => new Map, () => new Set, () => new WeakMap, () => new WeakSet, () => Promise.resolve(), () => Symbol.iterator, () => 10n, () => new Date(0), () => /a/, () => [], () => ({}), () => null, () => undefined, () => 1, () => "s", () => true,
  () => () => 1, () => function* () {}, () => (function* () {})(), () => async () => 1, () => new Tagged, () => Object.assign(new Tagged, { tag: "Other" }), () => new Plain, () => own, () => changing, () => strange, () => throwing,
  () => new Proxy([], {}), () => new Proxy(new Map, {}), () => new Uint8Array(1), () => new ArrayBuffer(1), () => new DataView(new ArrayBuffer(1)), () => new Error, () => (function () { return arguments; })(), () => Math, () => JSON, () => new (class extends Map {}), () => Object.create(new Map), () => globalThis, () => new Map().entries(), () => "ab"[Symbol.iterator](),
];
const isMap = (value) => tagOf(value) === "[object Map]", isSet = (value) => "[object Set]" === tagOf(value), isDate = (value) => tagOf(value) === "[object Date]", isTagged = (value) => tagOf(value) === "[object Tagged]";
const counts = new Map, log = [];
for (let turn = 0; turn < 300; turn++) {
  if (turn === 100) changing[Symbol.toStringTag] = "Second";
  if (turn === 200) delete own[Symbol.toStringTag];
  for (const make of makers) {
    let answer;
    try { const value = make(); answer = tagOf(value) + " " + isMap(value) + isSet(value) + isDate(value) + isTagged(value) + tagOf(value).length + tagOf(value).slice(8, -1); } catch (error) { answer = error.message; }
    counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }
}
for (const [answer, times] of counts) console.log(times, answer);
