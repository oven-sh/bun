function show(v: any): string { return Array.isArray(v) ? "[" + v.map(show).join(",") + "]" : typeof v; }
function attempt(f: () => any) { try { console.log(show(f())); } catch (e: any) { console.log(e.constructor.name); } }
let steps = 0;
class C { v: any; n = 1 as any; constructor(q: any) { this.n = steps; } }
class D extends C { constructor(q: any) { super(q); this.v = q; } }
function step(): void { steps++; }
for (let round = 0; round < 2; round++) {
  attempt(() => { class E extends C { constructor(q: any) { super(q); this.v = q + 1; } } const x = new E(2); return [x.v]; });
  attempt(() => { const x: any = new D(1); return [x.v, x.n]; });
}
console.log("done");
