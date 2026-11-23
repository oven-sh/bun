// A public field that holds numbers and now and then a value of another type: where the slot is found filled before the loop, no iteration empties it, because every store that the loop makes fits.
// STATISTIC: StoredSlotsTestedBeforeLoops >= 4
let calls = 0;
class Base { constructor(name) { this.name = name; } get kind() { return "base"; } }
class Heir extends Base { constructor(name) { super(name); this.own = 1; } get kind() { return "heir"; } }
class Account extends Base { constructor(name, list) { super(name); this.sum = 0; for (const x of list) this.sum += x; } get kind() { return "account"; } }
class Both extends Base { constructor(name, list) { super(name); this.total = 0; this.count = 0; for (const x of list) { this.total += x; this.count++; } } get kind() { return "both"; } }
class Product extends Base { constructor(name, list) { super(name); this.product = 1; for (const x of list) { this.product *= x; this.product -= 1; } } get kind() { return "product"; } }
class Odd extends Base { constructor(name, list) { super(name); this.odd = 0; for (const x of list) { if (x === 7) this.odd = name === "t" ? "seven" : name === "o" ? { seven: 7 } : 7n; this.odd += x; } } get kind() { return "odd"; } }
class Lost extends Base { constructor(name, list) { super(name); this.lost = 0; for (const x of list) { this.lost += x; if (x === 7) delete this.lost; } } get kind() { return "lost"; } }
class Other extends Base { constructor(name, list, other) { super(name); this.given = 0; other ??= this; for (const x of list) { this.given += x; if (x > 5) other.given = [x]; } } get kind() { return "other"; } }
class Added extends Base { constructor(name) { super(name); this.added = 0; } add(list) { for (const x of list) this.added += x; return this; } get kind() { return "added"; } }
const lists = [[1, 2, 3, -4], [0.5, 1.25, -3], [1, 7, 2], [1, "x", 4], [1, { valueOf() { calls++; return 2; } }, 3], [-0, -0], [], [1, undefined], [2147483647, 1], [1, 6, 8], [1n, 2n]];
const kinds = [Account, Both, Product, Odd, Lost, Other, Added], said = [];
const text = value => JSON.stringify(value, (key, held) => typeof held === "bigint" ? held + "n" : held === undefined ? "undefined" : Object.is(held, -0) ? "-0" : Number.isNaN(held) ? "NaN" : held);
let last = null;
for (let round = 0; round < 30; round++) {
  for (const list of lists) for (const Kind of kinds) {
    try {
      const made = round % 7 === 6 ? Reflect.construct(Kind, ["r", list, last], Heir) : new Kind(["n", "t", "o", "b"][round % 4], list, round % 5 === 4 ? last : null);
      said.push(text(made)); last = made;
      if (made instanceof Added) { if (round % 6 === 3) made.added = ["t", {}, 3n, undefined][round % 4]; said.push(text(made.add(list))); if (round % 6 === 5) { made.added = {}; made.added = 4; said.push(text(made.add(lists[0]))); } }
    } catch (error) { said.push(error.name); }
  }
}
let hash = 0;
for (const line of said) for (const c of line) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, calls, said.length);
console.log(said.slice(0, 14).join("\n"));
console.log(said.slice(-14).join("\n"));
console.log([new Base("x"), new Heir("y")].map(o => o.kind + o.name).join());
