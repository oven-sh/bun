// indexOf and includes are called by name on lists that nobody proves: whole numbers among values, at every length up to seventy, with a double, a hole or nothing in the last place.
"use strict";
const unseen = x => [x][JSON.parse("0")], half = JSON.parse("0.5"), out = [];
const at = (l, v) => l.indexOf(v), has = (l, v) => l.includes(v);
const say = (l, v) => { out.push(at(unseen(l), unseen(v)) + (has(unseen(l), unseen(v)) ? "y" : "n")); };
for (let n = 0; n <= 70; n++) for (const last of [n, half * 2 * n, undefined, null, -0, NaN, "x", 1n, n + half]) { const l = ["t"]; for (let i = 1; i < n; i++) l.push(i); l.push(last); for (const v of [n, n - 1, 0, 1, -1]) say(l, v); }
for (const l of [[, 1], ["a", , 2], [undefined, 3], new Array(5), Object.assign(["a"], { 3: 3 }), ["a", 1.5, 2], ["a", 2, 1.5], [1.5, 2.5, 3], [1, 2, 3], ["1", "2"], [[], {}, 1], Object.freeze(["a", 1]), Object.seal(["a", 1]), Object.preventExtensions(["a", 1])]) for (const v of [0, 1, 2, 3, -0, 1.5, NaN, undefined, null, "1", 2147483647, -2147483648]) say(l, v);
const over = "7,8,9,10".split(","); for (let i = 0; i < over.length; i++) { over[i] = parseInt(over[i]); for (const v of [7, 8, 9, 10, 11]) say(over, v); }
const turned = ["a", 1, 2, 3]; for (const deed of [l => { l[1] = half * 2; }, l => { l[1] = "1"; }, l => { delete l[1]; }, l => { l.length = 2; }, l => l.push(1), l => l.reverse(), l => l.sort(), l => { l[90] = 1; }, l => { l.length = 0; }]) { deed(turned); for (const v of [1, 2, 3]) say(turned, v); }
class Heir extends Array {} for (const l of [Heir.of("a", 1), Object.setPrototypeOf(["a", , 1], { __proto__: Array.prototype, 1: 7 }), { indexOf: v => "own" + v, includes: () => true }, "a1", new Uint8Array([1, 2])]) for (const v of [1, 7]) { try { out.push(String(at(unseen(l), v)), String(has(unseen(l), v))); } catch (e) { out.push(e.name); } }
console.log(out.join(" "));
