const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
const sparse: any[] = [, 1];
class Crate { tint: Tint; more: Tint; lit: boolean;
  constructor(seed: number) { this.tint = (seed & 7) as Tint; this.more = Tint.Red; this.lit = seed > 2; }
  wipe(v: any) { this.tint = v; }
  peek(): unknown { return this.tint; } }
const shelf: Crate[] = [];
function peekAt(o: Crate): unknown { return o.tint; }
function lay(o: Crate, v: any): void { o.tint = v; }
function run(c: any, d: any, k: any): unknown {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const u: any = d === true ? null : Tint.Gold;
  const n = k | 0;
  const x = new Crate(5);
  if (c === true) lay(x, u);
  return x.tint;
}
const runs: ((...all: any[]) => unknown)[] = [run, unseen(run)];
unseen(new Crate(0));
let last: unknown = 0;
for (let i = 0; i < 300; i++) { const one = unseen(new Crate(i)); shelf[0] = one; shelf[1] = one; last = runs[JSON.parse("0")](unseen((i & 1) === 1), unseen(false), unseen(3)); }
console.log("warm", say(last));
const hurt = unseen(new Crate(1)); shelf[0] = hurt; shelf[1] = hurt;
console.log("hurt", say(runs[JSON.parse("0")](unseen(true), unseen(true), unseen(3))));
console.log("kept", say(unseen(shelf[0]).tint));
console.log("again", say(runs[JSON.parse("0")](unseen(false), unseen(false), unseen(3))));
export {};
