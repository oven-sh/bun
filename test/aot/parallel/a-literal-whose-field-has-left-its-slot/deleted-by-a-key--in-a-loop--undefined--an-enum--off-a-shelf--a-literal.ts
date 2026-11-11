const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
const sparse: any[] = [, 1];
interface Crate { tint: Tint; more: Tint; lit: boolean; wipe(v: any): void; peek(): unknown; }
function wipeOf(this: Crate, v: any): void { this.tint = v; }
function peekOf(this: Crate): unknown { return this.tint; }
function makeCrate(seed: number): Crate { return { tint: (seed & 7) as Tint, more: Tint.Red, lit: seed > 2, wipe: wipeOf, peek: peekOf }; }
const shelf: Crate[] = [];
function peekAt(o: Crate): unknown { return o.tint; }
function lay(o: Crate, v: any): void { o.tint = v; }
const key: string = unseen("tint");
function run(c: any, d: any, k: any): unknown {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const u: any = d === true ? undefined : Tint.Gold;
  const n = k | 0;
  const x = shelf[0];
  x.more = Tint.Blue;
  work = (work + x.tint) | 0;
  let odd = 0;
  for (let i = 0; i < n; i++) { const r: unknown = x.tint; if (r === undefined) odd += 100; else if (r === null) odd += 10; if (c === true) { delete (x as any)[key]; } }
  return odd;
}
const runs: ((...all: any[]) => unknown)[] = [run, unseen(run)];
unseen(makeCrate(0));
let last: unknown = 0;
for (let i = 0; i < 300; i++) { const one = unseen(makeCrate(i)); shelf[0] = one; shelf[1] = one; last = runs[JSON.parse("0")](unseen((i & 1) === 1), unseen(false), unseen(3)); }
console.log("warm", say(last));
const hurt = unseen(makeCrate(1)); shelf[0] = hurt; shelf[1] = hurt;
console.log("hurt", say(runs[JSON.parse("0")](unseen(true), unseen(true), unseen(3))));
console.log("kept", say(unseen(shelf[0]).tint));
console.log("again", say(runs[JSON.parse("0")](unseen(false), unseen(false), unseen(3))));
export {};
