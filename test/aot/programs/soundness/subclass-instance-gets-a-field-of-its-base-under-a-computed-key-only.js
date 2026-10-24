// An instance of a subclass never gets the field of its base class by name, and gets it under a key that only the run knows.
const names = JSON.parse('["late", "tag"]');
class Base {
  constructor(withLate) {
    this.tag = "base";
    if (withLate) this.late = "text";
  }
  lateLength() {
    return this.late === undefined ? -1 : this.late.length;
  }
}
class Derived extends Base {
  constructor() {
    super(false);
    this.own = 1;
  }
}
const base = new Base(true);
const derived = new Derived();
derived[names[0]] = 5;
const other = new Derived();
other[names[1]] = { deep: 1 };
const out = [];
for (const o of [base, derived, other]) out.push(o.lateLength(), typeof o.tag, Object.keys(o).join("+"), JSON.stringify(o));
console.log(out.join(" | "));
let total = 0;
for (let i = 0; i < 9000; i++) {
  const o = i % 3 === 0 ? base : i % 3 === 1 ? derived : other;
  const n = o.lateLength();
  total += n === undefined ? 7 : n;
}
console.log(total);
