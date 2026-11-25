// A constructor below another class sums into its own fields in a loop. `this` comes out of super(), so the fields may be missing: one test before the loop answers for every iteration.
// STATISTIC: StoredSlotsTestedBeforeLoops >= 4
// STATISTIC: SlotsCarriedUnboxed >= 2
let calls = 0;
class Base { constructor(name) { this.name = name; if (name === "other") return new Foreign(); if (name === "fixed") Object.preventExtensions(this); if (name === "proxy") return new Proxy(this, {}); } get kind() { return "base"; } }
class Foreign { constructor() { this.sum = "foreign"; this.count = 9; } }
class Account extends Base {
  #sum = 0;
  #list;
  constructor(name, list) { super(name); this.#list = list; for (const x of this.#list) this.#sum += x; }
  get total() { return this.#sum; }
  get kind() { return "account"; }
}
class Open extends Base {
  sum = 0;
  constructor(name, list) { super(name); for (const x of list) this.sum += x; }
  get kind() { return "open"; }
}
class Products extends Base {
  product = 1; last = 0;
  constructor(name, list) { super(name); for (let i = 0; i < list.length; i++) { this.product *= list[i]; this.last = this.product - this.last; } }
}
class Several extends Open {
  #sum = 0.5; #squares = 0; #n = 0;
  constructor(name, list) { super(name, list); const self = this; for (const x of list) { this.#sum += x; this.#squares += x * x; self.#n++; if (x === 99) self.#sum = "ninety-nine"; } }
  get all() { return [this.#sum, this.#squares, this.#n, this.sum].join("/"); }
}
class Late extends Base {
  constructor(name, list) { super(name); for (const x of list) { if (this.sum === undefined) this.sum = 0; this.sum += x; } }
}
class Emptied extends Base {
  sum = 0;
  constructor(name, list) { super(name); for (const x of list) { this.sum += x; if (x === 7) delete this.sum; } }
}
const integers = [1, 2, 3, -4, 2147483647, 7], doubles = [0.5, 1.25, -3, 1e300, 4], mixed = [1, 2.5, "x", 4], writers = [1, { valueOf() { calls++; return 2; } }, 3], zeros = [-0, -0], none = [], ninety = [1, 99, 2], odd = [1, undefined, NaN, true, null];
const lists = [integers, doubles, mixed, writers, zeros, none, ninety, odd], kinds = [Account, Open, Products, Several, Late, Emptied];
const said = [];
for (let round = 0; round < 40; round++) {
  for (const list of lists) {
    for (const Kind of kinds) {
      const name = round % 10 === 9 ? ["other", "fixed", "proxy"][round % 3] : "n";
      let text;
      try {
        const made = round % 7 === 6 ? Reflect.construct(Kind, [name, list], kinds[(kinds.indexOf(Kind) + 1) % kinds.length]) : new Kind(name, list);
        text = made.kind + ":" + [made.total, made.sum, made.product, made.last, made.all].map(v => Object.is(v, -0) ? "-0" : String(v)).join(",");
      } catch (error) { text = error.name; }
      said.push(text);
    }
  }
}
let hash = 0;
for (const text of said) for (const c of text) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, calls, said.length);
console.log(said.slice(0, 12).join("\n"));
console.log(said.slice(-12).join("\n"));
