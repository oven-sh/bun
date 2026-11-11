class Box { size: number; lid: number; constructor(v: number) { this.size = v; this.lid = 1; } }
class Bag { weight: number; constructor(v: number) { this.weight = v; } }
class Jar { volume: number; constructor(v: number) { this.volume = v; } }
function total(x: Box | Bag | Jar | number): number {
  let n = 0;
  for (let i = 0; i < 2; i++) {
    n += (x as Box).size | 0;
    if (typeof x !== "number") n += ((x as Box).size | 0) * 100;
  }
  return n;
}
const open = new Box(5);
delete (open as any).lid;
const all: (Box | Bag | Jar | number)[] = [new Box(1), new Bag(2), new Jar(3), open, 4];
for (let i = 0; i < all.length; i++) console.log(total(all[i]!));
