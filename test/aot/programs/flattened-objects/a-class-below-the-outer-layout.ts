// The outer layout is a class, and another class extends it by way of a value: flow finds the base. Nobody holds the inner object, so its fields could become fields of the outer layout: the class below has the fields of its base at the same places.
class Base { inner = { n: 1, m: 2 }; count = 3; sum() { return this.inner.n + this.inner.m + this.count; } bump() { this.inner.n += 10; } }
function tagged(base: new () => Base) { return class extends base { tag = "tagged"; more = 4; all() { return this.sum() + this.more; } }; }
const Made = tagged(Base);
const made = new Made(), plain = new Base();
made.bump(); plain.bump(); plain.bump();
console.log(made.sum(), made.all(), made.tag, plain.sum(), made instanceof Base);
const many: Base[] = [];
for (let i = 0; i < 1000; i++) many.push(i & 1 ? new Made() : new Base());
let sum = 0;
for (const one of many) { one.bump(); sum += one.sum(); }
console.log(sum);
