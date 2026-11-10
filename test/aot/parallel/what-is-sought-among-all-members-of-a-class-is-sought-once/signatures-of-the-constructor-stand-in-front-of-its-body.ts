declare const console: { log(...values: unknown[]): void };
const show = (o: any) => Object.keys(o).sort().map(k => k + "=" + String(o[k])).join(",");
class C {
  a;
  b;
  constructor(v: number);
  constructor(v: string);
  constructor(v: any) { this.a = v; this.b = typeof v; }
}
const c = new C(1);
console.log(show(c), show(new C("s")));
