// One class expression is evaluated several times: over the same base twice, and over two bases that declare the same name with different types.
const names: string[] = JSON.parse('["x"]');
function show(o: object): string {
  const a = o as any;
  return typeof a.x + ":" + String(a.x) + " " + Object.keys(o).join("+") + " " + JSON.stringify(o);
}
{
  class P { x: number = 1; next(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const First = Mix(P);
  const Second = Mix(P);
  const a: P = new First();
  const b: P = new Second();
  function act(o: { x: number | string }): void { o.x = "text"; }
  act(b);
  const stored = show(b);
  b.x = 2;
  console.log("same base twice", a.next(), stored, b.next(), show(a), show(b), a instanceof First, a instanceof Second, b instanceof Second);
}
{
  class P { x: number = 1; next(): number { return this.x + 1; } }
  class Q { x: string = "s"; next(): string { return this.x + "!"; } }
  const Mix = <B extends new (...a: any[]) => object>(b: B) => class extends b { w: number = 4; };
  const OverP = Mix(P);
  const OverQ = Mix(Q);
  const p = new OverP();
  const q = new OverQ();
  console.log("two bases", p.next(), q.next(), show(p), show(q));
  (p as any)[names[0]] = "text";
  (q as any).x = 7;
  console.log("two bases", show(p), show(q));
  p.x = 3;
  q.x = "t";
  console.log("two bases", p.next(), q.next(), show(p), show(q));
  let total = 0;
  for (let i = 0; i < 4000; i++) total += i & 1 ? p.next() : q.next().length;
  console.log(total);
}
{
  class P { x: number = 1; next(): number { return this.x + 1; } }
  const makers: (() => P)[] = [];
  for (let i = 0; i < 3; i++) {
    const C = class extends (i < 9 ? P : P) { w: number = i; };
    makers.push(() => new C());
  }
  const all = makers.map(make => make());
  (all[1] as any).x = "text";
  console.log("in a loop", all.map(show).join(" | "));
  all[1].x = 5;
  console.log("in a loop", all.map(o => o.next()).join());
}
