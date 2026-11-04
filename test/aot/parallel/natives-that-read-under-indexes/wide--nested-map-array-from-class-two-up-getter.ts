let hits = 0;
class Top {
  get 0() { hits++; return (this as any).a; }
  get 1() { hits++; return (this as any).b; }
}
class Middle extends Top {}
class Holder extends Middle {
  a: string; b: number;
  constructor(a: string, b: number) { super(); this.a = a; this.b = b; }
}
const make = (a: string, b: number) => new Holder(a, b);
let out = "";
for (let i = 0; i < 300; i++) {
  const o = make("k" + i, i);
  let r: any;
  try {
    const list: Array<ReturnType<typeof make>> = []; list.push(o); const m = new Map((Array.from(list) as any)); r = m.get("k" + i);
  } catch (e) { r = "threw " + String(e); }
  if (i % 100 === 7) out += String(r) + ";";
}
console.log(out, hits);
