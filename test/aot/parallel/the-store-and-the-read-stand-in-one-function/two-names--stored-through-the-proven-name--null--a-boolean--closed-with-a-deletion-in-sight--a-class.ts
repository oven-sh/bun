const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
const sparse: any[] = [, 1];
class Crate { tint: Tint; more: Tint; lit: boolean;
  constructor(seed: number) { this.tint = (seed & 7) as Tint; this.more = Tint.Red; this.lit = seed > 2; }
  wipe(v: any) { this.lit = v; }
  peek(): unknown { return this.lit; } }
function strip(one: Crate): void { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; delete (one as any).lit; }
const shelf: Crate[] = [JSON.parse("{}") as Crate];
function run(mine: Crate, turn: number): string {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const u: any = (turn & 2) ? true : null;
  const other = shelf[1];
  const before: unknown = other.lit;
  mine.lit = u;
  const after: unknown = other.lit;
  return say(before) + " > " + say(after);
}
function drive(mine: Crate): string { let last = ""; for (let i = 0; i < 300; i++) last = run(mine, 6); return last; }
const kept = new Crate(1);
shelf.push(kept);
strip(new Crate(2));
console.log(drive(kept));
console.log(run(kept, 4));
console.log(run(kept, 6));
export {};
