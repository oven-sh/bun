let hits = 0;
class Top {
  get 0() { hits++; return this.a; }
  get 1() { hits++; return this.b; }
}
class Middle extends Top {}
class Holder extends Middle {
  constructor(a, b) { super(); this.a = a; this.b = b; }
}
const make = (a, b) => new Holder(a, b);
let out = "";
for (let i = 0; i < 300; i++) {
  const o = make({ n: i }, i);
  let r;
  try {
    const list = []; list.push(o); const m = new WeakMap(list); r = String(m.get(o.a));
  } catch (e) { r = "threw " + String(e); }
  if (i % 100 === 7) out += String(r) + ";";
}
console.log(out, hits);
