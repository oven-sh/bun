const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
const sparse: any[] = [, 1];
class Above { tint: Tint; more: Tint; constructor(seed: number) { this.tint = (seed & 7) as Tint; this.more = Tint.Red; } }
class Below extends Above { last: Tint; constructor(seed: number) { super(seed); this.last = Tint.Blue; this.tint = ((seed & 8) ? undefined : Tint.Red) as Tint; } }
const shelf: Above[] = [];
function run(c: any, d: any): unknown {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const u: any = d === true ? undefined : Tint.Gold;
  const n = unseen(3) | 0;
  const x = shelf[0];
  x.more = Tint.Blue;
  work = (work + x.tint) | 0;
  if (c === true) x.tint = u;
  return x.tint;
}
const runs: ((...all: any[]) => unknown)[] = [run, unseen(run)];
unseen(new Above(0)); unseen(new Below(0));
let last: unknown = 0;
for (let i = 0; i < 300; i++) { shelf[0] = unseen(i & 4 ? new Above(i) : new Below(i)); last = runs[JSON.parse("0")](unseen((i & 1) === 1), unseen(false)); }
console.log("warm", say(last));
shelf[0] = unseen(new Below(9));
console.log("born so", say(unseen(shelf[0]).tint), say(runs[JSON.parse("0")](unseen(false), unseen(false))));
shelf[0] = unseen(new Above(1));
console.log("hurt", say(runs[JSON.parse("0")](unseen(true), unseen(true))));
export {};
