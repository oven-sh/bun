const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
class Crate {
  tint: Tint;
  constructor(seed: number) { this.tint = (seed & 7) as Tint; }
}
const shelf: Crate[] = [JSON.parse("{}") as Crate];
function strip(one: Crate): void {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  delete (one as any).tint;
}
function repaint(mine: Crate, turn: number): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const next = (turn & 2) ? Tint.Gold : undefined;
  const other = shelf[1];
  const before: unknown = other.tint;
  mine.tint = next as Tint;
  const after: unknown = other.tint;
  return String(before) + " > " + String(after);
}
function drive(mine: Crate): string {
  let last = "";
  for (let i = 0; i < 300; i++) last = repaint(mine, 2);
  return last;
}
const kept = new Crate(1);
shelf.push(kept);
strip(new Crate(2));
console.log(drive(kept));
console.log(repaint(kept, 0));
console.log(repaint(kept, 2));
