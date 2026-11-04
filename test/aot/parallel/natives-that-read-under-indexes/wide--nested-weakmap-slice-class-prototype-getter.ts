let hits = 0;
class Holder {
  a: { n: number }; b: number;
  constructor(a: { n: number }, b: number) { this.a = a; this.b = b; }
  get 0() { hits++; return this.a; }
  get 1() { hits++; return this.b; }
}
const make = (a: { n: number }, b: number) => new Holder(a, b);
let out = "";
for (let i = 0; i < 300; i++) {
  const o = make({ n: i }, i);
  let r: any;
  try {
    const list: Array<ReturnType<typeof make>> = []; list.push(o); const m = new WeakMap((list.slice() as any)); r = String(m.get(o.a));
  } catch (e) { r = "threw " + String(e); }
  if (i % 100 === 7) out += String(r) + ";";
}
console.log(out, hits);
