// splice with no, one and several values over lists of every kind, at every place, with room and without.
const kinds = { whole: k => k - 3, fractions: k => k * 0.5 - 1, texts: k => "t" + k, mixed: k => (k % 3 ? k : k % 2 ? "m" + k : { k }), none: () => undefined };
const values = { whole: [7, -8, 9, 0], fractions: [0.5, -0, 1e300, 2.25], unusual: [NaN, Infinity, 2 ** 31, -0], texts: ["x", "", "y", "z"], mixed: [1, "a", null, undefined], lists: [[1], [], [2], {}], big: [1n, 2n, 3n, 4n] };
const show = list => "[" + Array.from({ length: list.length }, (_, k) => (k in list ? (typeof list[k] === "object" && list[k] ? JSON.stringify(list[k]) : typeof list[k] === "bigint" ? list[k] + "n" : Object.is(list[k], -0) ? "-0" : typeof list[k] === "string" ? JSON.stringify(list[k]) : String(list[k])) : "hole")).join() + "]";
let hash = 7; const note = text => { for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0; };
function listOf(size, at) { const list = []; for (let k = 0; k < size; k++) list.push(at(k)); return list; }
function none(list, from, count) { return list.splice(from, count); }
function one(list, from, count, a) { return list.splice(from, count, a); }
function two(list, from, count, a, b) { return list.splice(from, count, a, b); }
function three(list, from, count, a, b, c) { return list.splice(from, count, a, b, c); }
function four(list, from, count, a, b, c, d) { return list.splice(from, count, a, b, c, d); }
function spread(list, from, count, all) { return list.splice(from, count, ...all); }
let turns = 0;
for (const [kind, at] of Object.entries(kinds)) for (const [named, given] of Object.entries(values)) {
  const lines = [];
  for (const size of [0, 1, 2, 4, 5, 9, 16, 17, 18, 33]) for (const from of [0, 1, 3, size - 1, size, size + 4, -1, -3, -40, 1.5, "2", undefined]) for (const count of [0, 1, 2, 4, size, size + 9, -2, 1.9, undefined]) {
    const [a, b, c, d] = given; let list, gone;
    for (const f of [none, one, two, three, four]) { list = listOf(size, at); gone = f(list, from, count, a, b, c, d); lines.push(show(list) + show(gone)); list.push(1); lines.push(list.length + " " + (gone.length > 1 ? gone.indexOf(list[0]) : gone.push("p"))); turns++; }
    list = listOf(size, at); gone = spread(list, from, count, given); lines.push(show(list) + show(gone));
  }
  const text = lines.join("\n"); note(text); console.log(kind, named, lines.length, hash);
}
// One list that grows and shrinks; holes, a vector with room in front, a frozen list, sealed, not extensible, a list with a name, long lists, a subclass, a list with another species.
const long = []; for (let round = 0; round < 900; round++) { long.splice(round % (long.length + 1), round % 3, round, round + 0.5); if (round % 7 === 0) long.splice(0, 2); if (round % 50 === 0) long.shift(); if (round % 90 === 0) long.unshift("u"); } note(show(long)); console.log(long.length, hash);
const many = []; for (let k = 0; k < 4000; k++) many.push(k); console.log(many.splice(10, 2500, ...many.slice(0, 2600)).length, many.length, many.splice(5, 1, "a", "b", "c").join(), many.length, many.splice(100, 3900, 1, 2).length, many.length, many.splice(1, 1200, ..."abcdef").length, many.length, show(many.slice(0, 9)));
for (const make of [() => [, 1, , 2.5, ,], () => [1, , 3, , , 6], () => ["a", , "c"], () => { const l = [1, 2, 3]; delete l[1]; return l; }, () => { const l = []; l[6] = 1; return l; }, () => { const l = [1, 2, 3, 4, 5, 6]; l.shift(); l.shift(); return l; }, () => Object.assign([1, 2, 3], { name: "n" })])
  for (let from = 0; from < 5; from++) for (let count = 0; count < 4; count++) { const l = make(); const gone = l.splice(from, count, 8, 9); const m = make(); const went = m.splice(from, count); const n = make(); const left = n.splice(from, count, "s"); note(show(l) + show(gone) + show(m) + show(went) + show(n) + show(left)); }
console.log(hash);
for (const bad of [Object.freeze([1, 2, 3]), Object.freeze([]), Object.seal([1, 2, 3]), Object.preventExtensions([1, 2, 3]), Object.defineProperty([1, 2, 3], "length", { writable: false }), Object.defineProperty([1, 2, 3], 1, { get: () => 7, configurable: true }), Object.defineProperty([1, 2, 3], 1, { value: 5, configurable: false })])
  for (const f of [l => l.splice(0, 1), l => l.splice(1, 0, 8, 9), l => l.splice(1, 1, 8, 9), l => l.splice(0, 0), l => l.splice(1, 2, 8, 9)]) { try { note(show(f(bad)) + show(bad)); } catch (error) { note(error.name + show(bad)); } }
console.log(hash);
class Sub extends Array { } const sub = Sub.from([1, 2, 3, 4]); console.log(sub.splice(1, 2, 8, 9, 10) instanceof Sub, show(sub));
const other = [1, 2, 3]; other.constructor = { [Symbol.species]: function (n) { this.made = n; } }; const odd = other.splice(1, 1, 5, 6); console.log(odd.made, odd.length, show(other));
const order = []; const from = { valueOf() { order.push("from"); return 1; } }, count = { valueOf() { order.push("count"); late.length = 2; return 1; } }, late = [1, 2, 3, 4]; console.log(show(late.splice(from, count, 8, 9)), show(late), order.join());
const above = list => Object.setPrototypeOf(list, Object.create(Array.prototype, { 2: { value: "inherited", writable: true, configurable: true, enumerable: true } })); const inherits = above([1, 2, , 4]); console.log(show(inherits.splice(1, 1, 8, 9)), inherits.join()); const inheritsToo = above([1, , , 4]); console.log(inheritsToo.splice(0, 1).join(), inheritsToo.join());
console.log(show([1, 2, 3].splice(1, 1, 8, 9)), turns, hash);
