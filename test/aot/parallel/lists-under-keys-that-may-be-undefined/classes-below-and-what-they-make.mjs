// Lists and views of a class below that are made by roads other than `new`: of, from, Reflect.construct with a new target, a species laid on a plain list, what map, slice, concat, subarray make of them. The getter below writes on what it gets.
const q = []; const t = f => { try { return String(f()); } catch (e) { return e.name; } };
class L extends Array { get undefined() { this[0] = "seen"; return "L" + this.length; } }
class V extends Uint8Array { get undefined() { this[0] = 77; return "V" + this.length; } get null() { return "vn"; } }
const made = [L.of(1, 2), L.from([1, 2]), Array.of.call(L, 1, 2), Array.from.call(L, [1, 2]), Reflect.construct(Array, [1, 2], L), new L(1, 2), L.of(1, 2).map(x => x), L.of(0, 1, 2).slice(1), L.of(1).concat([2]), L.of(1, 2, 3).filter(x => x < 3)];
for (const x of made) console.log(t(() => x[q.shift()]), x[0], x.length);
const plain = [1, 2]; plain.constructor = { [Symbol.species]: L }; const bySpecies = plain.map(x => x); console.log(t(() => bySpecies[q.pop()]), bySpecies[0], plain[q.pop()], plain[0]);
const views = [new V(2), V.of(1, 2), V.from([1, 2]), new V(4).subarray(1, 3), new V(2).map(x => x), Reflect.construct(Uint8Array, [2], V), new V(3).slice(1)];
for (const x of views) console.log(t(() => x[q.shift()]), x[0], x.length, x[null]);
const mixed = [[1, 2], L.of(1, 2), new Uint8Array(2), new V(2)]; let s = ""; for (const x of mixed) s += x[q.pop()] + "," + x[0] + " "; console.log(s);
function rest(...all) { return all[q.pop()]; } function args() { return arguments[q.pop()]; } console.log(rest(1, 2), args(1, 2));
