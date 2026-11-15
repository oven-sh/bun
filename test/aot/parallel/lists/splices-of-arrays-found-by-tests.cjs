"use strict";
// STATISTIC: SplicesGuardedAtCalls >= 1
// splice() with new elements, whose result nobody reads, on an array that only a test finds: frozen arrays, holes, accessors, subclasses, own methods, arrays of numbers and proxies behave as ever.
function flatten(list, map) { for (let i = 0; i < list.length; i++) { const command = list[i]; if (command.charAt) { const found = map[command]; if (Array.isArray(found)) list.splice(i++, 1, found[0], found[1]); else list[i] = found; } else { if (command > 32000) { const divisor = list[i + 1]; list.splice(i, 3, 28, (command / divisor) >> 8, (command / divisor) & 255); } else list.splice(i, 1, 28, command >> 8, command & 255); i += 2; } } return list; }
function insert(list, at, count, value, times) { for (let i = 0; i < times; i++) { list.splice(at, count, value, i); if (list.length > 60) break; } return list; }
const map = { a: 1, b: [12, 35], c: 14, d: [12, 18], e: 5 };
const answers = [];
const say = (make) => { try { answers.push(make()); } catch (error) { answers.push(error.name + ":" + error.message.slice(0, 30)); } };
const copy = (list) => Array.from(list);
const lists = [["a", 5, "b", 40000, 2, "x", "c"], ["b", "d", "b", "d"], [1, 2, 3, 4, 5, 6, 7], [300, -300, 70000, 7, 0, "e"], [], ["a"], [0.5, 1.5, 2.5], Array.from({ length: 40 }, (_, i) => i % 3 ? i * 900 : "abcde"[i % 5])];
for (const list of lists) say(() => JSON.stringify(flatten(copy(list), map)));
for (const at of [0, 1, -1, 2, 100, -100, 1.5, NaN, "1", undefined, null, 2 ** 31, -(2 ** 31), Infinity]) for (const count of [0, 1, 2, 100, -1, 0.5, "2", undefined]) say(() => insert([1, 2, 3, "x"], at, count, "v", 3).join());
for (const make of [() => [1, 2, 3], () => [1.5, 2.5], () => [, 1, , 2], () => ["a", {}], () => new Array(5), () => Object.freeze([1, 2]), () => Object.seal([1, 2]), () => Object.preventExtensions([1, 2]), () => Object.defineProperty([1, 2], "length", { writable: false }), () => Object.defineProperty([1, 2, 3], 1, { get() { return "get"; }, set(v) { answers.push("set " + v); }, configurable: true }), () => new (class Sub extends Array {})(1, 2, 3), () => { const list = [1, 2, 3]; list.splice = function (...rest) { answers.push("own " + rest.join()); this.length += 20; return 0; }; return list; }, () => { const list = [1, 2, 3]; list.constructor = { [Symbol.species]: function () { answers.push("species"); return []; } }; return list; }, () => new Proxy([1, 2, 3], {}), () => ({ length: 2, 0: "o", 1: "p", splice: Array.prototype.splice }), () => "text", () => { const list = [1, 2]; list[50] = 3; return list; }, () => [1, 2, 3].fill(undefined)]) for (const [at, count] of [[0, 0], [1, 1], [-1, 2], [5, 0]]) say(() => { const list = insert(make(), at, count, at ? "w" : 1.25, 4); return Object.prototype.toString.call(list) + JSON.stringify(list) + Object.keys(list).length; });
say(() => JSON.stringify(flatten(["b", 5, "d"], map)));
let sum = 0;
const all = answers.join("|");
for (let i = 0; i < all.length; i++) sum = (Math.imul(sum, 31) + all.charCodeAt(i)) | 0;
console.log(all.length, sum);
console.log(all.slice(0, 1500));
