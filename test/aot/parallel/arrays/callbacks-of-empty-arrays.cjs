"use strict";
const out = [];
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "function" ? "function" : Array.isArray(v) ? (v.constructor === Array ? "" : v.constructor?.name) + "[" + v.join() + "]" + v.length : typeof v === "object" && v !== null ? "{" + Object.keys(v).join() + "}" : String(v));
const say = (...v) => out.push(v.map(show).join(" "));
const attempt = f => {
  try {
    return f();
  } catch (error) {
    return error.name;
  }
};
class Heir extends Array {}
let calls = 0;
const lists = JSON.parse("[[],[1],[],[1.5,2],[],[\"a\",\"b\",\"c\"],[]]");
lists.push(new Array(0), new Array(3), [,], Object.freeze([]), Heir.of(), Object.assign([], { extra: 1 }), [1, 2].filter(() => false));
const popped = [1];
popped.pop();
const shortened = [0.5, 1.5];
shortened.length = 0;
const shifted = [{}];
shifted.shift();
const far = [];
far[1000000] = 1;
far.length = 0;
lists.push(popped, shortened, shifted, far);

function everyMethod(list, record) {
  say("map", list.map(value => record.name + value));
  say("filter", list.filter(value => (calls++, value)));
  say("flatMap", list.flatMap(value => [value, record.name]));
  say("forEach", list.forEach(value => void (record.name += value)));
  say("every", list.every(value => value > record.limit));
  say("some", list.some(value => value === record.limit));
  say("find", list.find(value => value === record.limit));
  say("findIndex", list.findIndex(value => value === record.limit));
  say("findLast", list.findLast(value => value === record.limit));
  say("findLastIndex", list.findLastIndex(value => value === record.limit));
  say("reduce", list.reduce((sum, value) => sum + value, record.limit));
  say("reduceRight", list.reduceRight((sum, value) => sum + value, record.name));
  say("reduce alone", attempt(() => list.reduce((sum, value) => sum + value)));
}

function copies(list, callback) {
  const mapped = list.map(callback);
  const kept = list.filter(callback);
  const flat = list.flatMap(callback);
  say(mapped === list, kept === list, mapped === kept, Array.isArray(mapped), flat.length);
  for (let i = 0; i < 9; i++) mapped.push(i, i * 0.5);
  kept[2] = "far";
  kept.unshift(-0);
  flat.push({});
  say(mapped, kept, flat.length, Object.keys(kept));
}

const notCallable = [undefined, null, 1, "map", {}, [], Symbol.iterator, 7n];
const callables = [x => x, function () { return this; }, Math.abs, Heir, class A {}, (x => x).bind(null), new Proxy(x => x, {}), Array.prototype.map, async x => x, function* () {}, parseInt, Object.assign(x => x, { own: 1 })];

for (let round = 0; round < 3; round++) {
  for (const list of lists) {
    attempt(() => everyMethod(list, { name: "n" + round, limit: round }));
    for (const callback of callables) say(attempt(() => list.map(callback).length), attempt(() => list.some(callback)), attempt(() => list.reduce(callback, "initial")));
  }
  for (const callback of notCallable) {
    say(attempt(() => [].map(callback)), attempt(() => [].filter(callback)), attempt(() => [].forEach(callback)), attempt(() => [].every(callback)));
    say(attempt(() => [].find(callback)), attempt(() => [].findLastIndex(callback)), attempt(() => [].reduce(callback, 1)), attempt(() => [].flatMap(callback)));
  }
  for (const list of lists) if (!list.length) attempt(() => copies(list, x => x));
  say(attempt(() => [].map()), attempt(() => [].some()), attempt(() => [].reduceRight()));
  say([].map(x => x, { length: 1 }), [].filter(Boolean), [].every(Boolean), [].some(Boolean));
}

const withSpecies = [];
withSpecies.constructor = { [Symbol.species]: function (length) { return { made: length }; } };
say(withSpecies.map(x => x), withSpecies.filter(x => x), withSpecies.flatMap(x => x), withSpecies.every(x => x));
const withMap = Object.assign([], { map: () => "own" });
say(withMap.map(x => x), withMap.filter(x => x));
const moved = Object.setPrototypeOf([], Heir.prototype);
say(moved.map(x => x), moved.filter(x => x), moved.map(x => x) instanceof Heir);
const proxied = new Proxy([], { get: (target, key) => (say(String(key)), target[key]) });
say(proxied.map(x => x), proxied.some(x => x));
say(Array.prototype.map.call([], x => x), Array.prototype.map.call("", x => x), Array.prototype.every.call({ length: 0 }, x => x), attempt(() => Array.prototype.map.call(null, x => x)));
say([].concat([]).map(x => x).filter(x => x).flatMap(x => x));
console.log(calls);
console.log(out.join("\n"));
