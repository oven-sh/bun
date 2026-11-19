// Few primitives are joined on the stack: numbers of every kind, holes, undefined, null and booleans beside strings. Every text is made several times, and beside another of the same length.
let calls = 0;
const object = { toString() { calls++; return "object"; } };
const wide = "中", accented = "é", long = "x".repeat(250);
const fill = (size, step) => { const list = []; for (let i = 1; i <= size; i++) for (let k = i; k < size; k += step) { if (list[k] === undefined) list[k] = 0; list[k] += i; } return list; };
const many = (length, make) => { const list = []; for (let i = 0; i < length; i++) list.push(make(i)); return list; };
const lists = [
  () => [], () => [7], () => [0.5], () => [null], () => [undefined], () => [true], () => [""], () => ["a"], () => [accented], () => [wide], () => [, ], () => [, , ], () => [-0], () => [NaN],
  () => [1, , 3], () => [1, , 4], () => [, 1.5], () => [, 2.5], () => [1.5, 2.5], () => [1.5, NaN], () => [NaN, -0, Infinity, -Infinity], () => [1e21, 1e-7, 123456789012345680000],
  () => [2147483647, 2147483648, -2147483648, -2147483649, 4294967296], () => [9, 10, 99, 100, 999, 1000, 1023, 1024, 99999], () => [-1, -9, -10, -1023, -1024],
  () => [true, false, null, undefined], () => ["x", null, 2.5], () => ["y", null, 2.5], () => ["", 0, ""], () => [accented, , 0.25], () => [wide, , 0.25], () => ["a" + calls + "b", 1.5], () => [long, 1.5], () => [long, long, , 1.5],
  () => fill(8, 2), () => fill(6, 5), () => fill(12, 7), () => fill(40, 3), () => many(31, i => i / 2), () => many(32, i => i / 2), () => many(33, i => i / 2), () => many(32, i => i % 3 ? i : undefined), () => many(17, i => i * 100000),
  () => [1, object, , 2], () => [1.5, [2.5, , [3.5]]], () => [1n, , 2.5], () => Object.freeze([1, , 2.5]), () => { const list = [1.5, 2.5]; list.length = 4; return list; }, () => { const list = [0.5, 1.5, 2.5]; delete list[1]; return list; },
  () => { const list = [1, , 2]; list.push(list); return list; }, () => new Array(3), () => { const list = new Array(6); list[4] = 1.25; return list; },
];
for (let turn = 0; turn < 3; turn++) {
  for (const make of lists) {
    const list = make();
    console.log(list.join(), list.join(""), list.join("-"), list.join(", "), list.join(wide), list.join(accented), list.join(null), String(list), `${list}`.length, calls);
  }
}
class Heir extends Array {}
Heir.prototype[1] = "inherited";
const heir = new Heir(); heir[0] = 1; heir[2] = 2.5;
console.log(heir.join("|"), Heir.from([1, undefined, 2.5]).join("|"));
const plain = [1, , 2.5]; Object.setPrototypeOf(plain, Heir.prototype); console.log(plain.join("|"), Array.prototype.join.call(plain, "/"));
for (const odd of [[1, Symbol("s"), 2.5], [0.5, Symbol.iterator]]) { try { console.log(odd.join()); } catch (error) { console.log(error.constructor.name); } }
