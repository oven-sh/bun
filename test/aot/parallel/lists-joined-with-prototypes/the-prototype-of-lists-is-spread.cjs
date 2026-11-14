// Array.prototype is a list that is no instance of a list's class: concat() spreads it.
class Heir extends Array {}
const heir = Heir.of(4, 5), bound = Array.prototype.concat.bind([0]);
const parts = { prototype: Array.prototype, heir, heirPrototype: Heir.prototype, list: [4, , 5], proxy: new Proxy([6, 7], {}), record: { length: 1, 0: 8 }, spread: { length: 1, 0: 8, [Symbol.isConcatSpreadable]: true }, text: "9", made: Object.create(Array.prototype), name: Object.create([1]), args: (function () { return arguments; })(1, 2), view: new Uint8Array(2) };
const show = list => list.length + ":" + Array.from(list, x => x === Array.prototype ? "prototype" : x === Heir.prototype ? "heir's" : typeof x === "object" ? Object.prototype.toString.call(x) : String(x)).join() + ":" + (0 in list) + (1 in list);
for (const name in parts) {
  const part = parts[name];
  console.log(name, show([1].concat(part)), show([1.5].concat(part)), show(["a"].concat(part)), show([].concat(part)), show(bound(part)), show(heir.concat(part)));
}
console.log(show([1].concat(Array.prototype)), show([1].concat(Array.prototype, 2)), [1].concat(Array.prototype).length);
