const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
const sparse: any[] = [, 1];
class Crate { tint: Tint; more: Tint; lit: boolean;
  constructor(seed: number) { this.tint = (seed & 7) as Tint; this.more = Tint.Red; this.lit = seed > 2; }
  wipe(v: any) { this.lit = v; }
  peek(): unknown { return this.lit; } }
function strip(one: Crate): void { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; delete (one as any).lit; }
function run(turns: number, depth: number): string {
  let odd = 0; let values = 0;
  for (let i = 0; i < turns; i++) {
    const x = new Crate(i);
    const u: any = (i & 2) ? true : null;
    let r: unknown = 0;
    for (let k = 0; k < depth; k++) { r = x.lit; if (r === undefined) odd += 1000; else if (r === null) odd += 10000; x.lit = (k & 1) ? true : u; }
    if (r === undefined) odd += 100; else if (r === null) odd += 10; else values++;
  }
  return odd + " odd, " + values + " values";
}
strip(new Crate(2));
console.log(run(4, 4));
console.log(run(400, 4));
export {};
