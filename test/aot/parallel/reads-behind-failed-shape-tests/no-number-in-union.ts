class Box { size: number; lid: number; constructor(v: number) { this.size = v; this.lid = 1; } }
class Bag { weight: number; constructor(v: number) { this.weight = v; } }
class Jar { volume: number; constructor(v: number) { this.volume = v; } }
function describe(x: Box | Bag | Jar): string {
  let s = "";
  s += (x as Box).size;
  if (typeof x !== "number") s += "/" + (x as Box).size;
  return s;
}
const open = new Box(5);
delete (open as any).lid;
const all: (Box | Bag | Jar)[] = [new Box(1), new Bag(2), new Jar(3), open];
for (let i = 0; i < all.length; i++) console.log(describe(all[i]!));
