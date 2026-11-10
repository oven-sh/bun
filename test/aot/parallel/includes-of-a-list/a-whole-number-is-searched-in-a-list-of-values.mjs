// indexOf and includes of a whole number where the list has held texts, holds nothing, holes, doubles that are the same number, or is longer than is searched one by one.
const unseen = x => [x][JSON.parse("0")], call = (list, name, value) => list[name](value);
const over = text => { const l = text.split(","); for (let i = 0; i < l.length; i++) l[i] = parseInt(l[i]); return l; };
const float = new Float64Array([1, 2, -0, 5]), half = JSON.parse("0.5");
const lists = {
  "over texts": over("1,5,9,13,-7,0"), "with texts": ["1", 1, "5", 5, null, undefined, true, 2], holes: [, "x", 3, , 4], behind: ["a", {}, [], 3, 3], none: over(""), one: over("3"),
  double: ["x", half + half, 1, half * 4, 2], "double behind": ["x", 1, half + half], zero: ["x", -0, 0], "read off a view": ["x", float[0], float[1], float[2], float[3]], nan: ["x", NaN, 1], big: ["x", 1n, 1, 2n, 2],
  edges: ["x", 2147483647, -2147483648, 2147483648, -2147483649], long: ["x", ...Array.from({ length: 40 }, (_, i) => i)], "thirty-two": ["x", ...Array.from({ length: 31 }, (_, i) => i)], "thirty-three": ["x", ...Array.from({ length: 32 }, (_, i) => i)], "sixty-four": ["x", ...Array.from({ length: 63 }, (_, i) => i)], "sixty-five": ["x", ...Array.from({ length: 64 }, (_, i) => i)], "whole, sixty-four": Array.from({ length: 64 }, (_, i) => i), "whole, sixty-five": Array.from({ length: 65 }, (_, i) => i), "texts, forty": Array.from({ length: 40 }, (_, i) => "t" + i),
  frozen: Object.freeze(["x", 1, 2]), sealed: Object.seal(["x", 1]), literal: ["x", 3, 4], shrunk: (() => { const l = ["x", 1, 2, 3]; l.length = 2; return l; })(), boxed: [Object(1), 1], lists: [[1], 1],
};
const values = [1, 2, 3, 5, 0, -0, -7, 4, 2147483647, -2147483648, 2147483648, half + half, half, NaN, "1", 1n, null, undefined, true, 39, 30, 31, 32, 62, 63, 64, "t39", "t31"];
for (let round = 0; round < 3; round++) for (const name of Object.keys(lists)) { const l = unseen(lists[name]), out = []; for (const v of values) out.push(call(l, "indexOf", unseen(v)), call(l, "includes", unseen(v)) ? "y" : "n"); if (round !== 1) console.log(name, out.join(" ")); }
class Heir extends Array {} const heir = Heir.from(["x", 1, 2]), own = ["x", 1]; own.indexOf = () => "own"; const above = ["x", , 1]; Object.setPrototypeOf(above, { __proto__: Array.prototype, 1: 7 });
for (const l of [heir, own, above, new Proxy(["x", 1], {}), { length: 2, 0: "x", 1: 1 }]) for (const v of [1, 7]) try { console.log(call(unseen(l), "indexOf", v), Array.prototype.indexOf.call(l, v), Array.prototype.includes.call(l, v)); } catch (e) { console.log(e.name); }
for (const from of [0, 1, 2, -1, 9]) console.log(lists["over texts"].indexOf(5, from), lists.behind.indexOf(3, from), lists.behind.includes(3, from));
