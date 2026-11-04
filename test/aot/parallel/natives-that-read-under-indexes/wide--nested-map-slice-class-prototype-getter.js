let hits = 0;
class Holder {
  constructor(a, b) { this.a = a; this.b = b; }
  get 0() { hits++; return this.a; }
  get 1() { hits++; return this.b; }
}
const make = (a, b) => new Holder(a, b);
let out = "";
for (let i = 0; i < 300; i++) {
  const o = make("k" + i, i);
  let r;
  try {
    const list = []; list.push(o); const m = new Map((list.slice())); r = m.get("k" + i);
  } catch (e) { r = "threw " + String(e); }
  if (i % 100 === 7) out += String(r) + ";";
}
console.log(out, hits);
