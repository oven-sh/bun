let hits = 0;
class Holder {
  a: string; b: number;
  constructor(a: string, b: number) { this.a = a; this.b = b; }
  get 0() { hits++; return this.a; }
  get 1() { hits++; return this.b; }
}
const make = (a: string, b: number) => new Holder(a, b);
let out = "";
for (let i = 0; i < 300; i++) {
  const o = make("k" + i, i);
  let r: any;
  try {
    const list: Array<ReturnType<typeof make>> = []; list.push(o); const m = new Map((new Map([[1, o]]).values() as any)); r = m.get("k" + i);
  } catch (e) { r = "threw " + String(e); }
  if (i % 100 === 7) out += String(r) + ";";
}
console.log(out, hits);
