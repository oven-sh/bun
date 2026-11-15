declare const console: { log(...values: unknown[]): void };
const show = (o: any) => Object.keys(o).sort().map(k => k + "=" + String(o[k])).join(",");
class C {
  // @ts-ignore
  declare x: number;
  // @ts-ignore
  declare x: number;
  constructor(v: number) { this.x = v; this.x = v + 1; }
}
console.log(show(new C(1)));
