const out = [];
const list = JSON.parse("[3,1,4,1,5,9,2,6]");
const mixed = JSON.parse('[1,"2",null,4.5,true]');
let closed = 0;
class List { constructor() { this.head = null; } add(v) { this.head = { v, next: this.head }; return this; } *[Symbol.iterator]() { try { for (let at = this.head; at; at = at.next) yield at.v; } finally { closed++; } } }
class Bag { constructor(vs) { this.vs = vs; } *[Symbol.iterator]() { for (const v of this.vs) yield v; } *pairs() { for (let i = 0; i < this.vs.length; i++) yield [i, this.vs[i]]; } }
class Tree { constructor(v, l, r) { this.v = v; this.l = l; this.r = r; } *[Symbol.iterator]() { if (this.l) yield* this.l; yield this.v; if (this.r) yield* this.r; } }
function* range(a, b) { for (let k = a; k < b; k++) yield k; }
function* shout(words) { for (const w of words) { const got = yield w + "!"; if (got) out.push("got " + got); } }
const linked = new List().add(1).add(2).add(3).add(4), bag = new Bag(list), odd = new Bag(mixed), tree = new Tree(2, new Tree(1), new Tree(4, new Tree(3), null));
function nests() { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]; for (const v of linked) s = (s + v * x) | 0; for (const v of bag) { if (v > x) break; s += v; } for (const [k, v] of bag.pairs()) s += k * v; } return s; }
function mixes() { let s = ""; for (let i = 0; i < mixed.length; i++) { const x = mixed[i]; for (const v of odd) { s += v; if (v === x) break; } s += x; } return s; }
function stores() { let s = 0; const copy = list.slice(); for (let i = 0; i < copy.length; i++) { for (const v of range(0, copy[i] & 3)) { copy[(i + v) & 7] = v; s += copy[i]; } } return s + ":" + copy; }
function throwsIn() { let s = 0; for (let i = 0; i < list.length; i++) { try { for (const v of linked) { if (v === list[i]) throw new Error("e" + v); s += v; } } catch (error) { s += error.message.length; } finally { s += 100; } } return s; }
function labels() { let s = 0; outer: for (let i = 0; i < list.length; i++) { for (const v of tree) { for (const w of range(0, v)) { if (w === 2) continue outer; if (list[i] === 9) break outer; s += w + v; } } } return s; }
function whiles() { let s = 0, i = 0; while (i < list.length) { for (const v of tree) s += v * list[i]; i++; do { for (const w of range(i, i + 2)) s -= w; } while (s < 0); } return s; }
function words() { let s = ""; for (const x of list) { for (const w of shout(["a", "b"])) s += w + x; } return s; }
function handed(over) { let s = 0; for (let i = 0; i < list.length; i++) for (const v of over) s += typeof v === "number" ? v * list[i] : String(v).length; return s; }
for (let round = 0; round < 2; round++) out.push(nests(), mixes(), stores(), throwsIn(), labels(), whiles(), words(), handed(linked), handed(bag), handed(odd), handed([1, 2]), handed(new Set([5])), closed);
let s = 0;
for (let i = 0; i < list.length; i++) { const x = list[i]; for (const v of linked) s = (s + v + x) | 0; for (const v of new List().add(x).add(i)) { if (v === 9) break; s += v; } }
out.push(s, closed);
List.prototype[Symbol.iterator] = function* () { yield 7; };
out.push(nests(), handed(linked), closed);
console.log(out.join("\n"));
