class A extends Array {
  constructor() { super(); this.prepare(); try { this.x = 1; } catch (e) { this.error = e.name; } this.seen = this.x; }
  prepare() {}
}
var picked;
const table = { other: Object, undefined: A };
function pickedKey() { return picked; }
class B extends table[pickedKey()] {
  prepare() { Object.defineProperty(this, "x", { value: "fixed", writable: false, configurable: true, enumerable: false }); }
}
picked = "other";
const o = new B();
console.log(o.seen, o.x, o.error, typeof o.seen === "string" ? o.seen.length : o.seen + 1);
const a = new A();
console.log(a.seen, a.x, a.error, typeof a.seen === "string" ? a.seen.length : a.seen + 1);
