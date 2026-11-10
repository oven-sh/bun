// STATISTIC: ReadsToldApartByShape >= 1
abstract class Shelf {
  abstract readonly count: number;
  abstract label(): string;
}
class Box extends Shelf {
  constructor(public items: string) { super(); }
  get count(): number {
    if (this.items === "boom") throw new RangeError("a box that cannot be counted");
    return this.items.length;
  }
  label(): string { return "box"; }
}
class Crate extends Shelf {
  readonly count: number;
  constructor(readonly left: Shelf, readonly right: Shelf) {
    super();
    this.count = left.count + right.count;
  }
  label(): string { return "crate"; }
  weigh(): number { return this.left.count * 100 + this.right.count; }
  heavier(): string { return this.left.count > this.right.count ? this.left.label() : this.right.label(); }
  twice(): number { return this.left.count + this.left.count; }
  handedOn(): string { return describe(this.left.count, this.right.count); }
  guarded(): string {
    try {
      return "counted " + this.left.count;
    } catch (error) {
      return (error as Error).name + ": " + (error as Error).message;
    }
  }
  inLoop(turns: number): number {
    let sum = 0;
    for (let turn = 0; turn < turns; turn++) sum += this.left.count - this.right.count;
    return sum;
  }
}
function describe(first: number, second: number): string { return first + "/" + second; }
function show(what: string, crate: Crate): void {
  console.log(what, crate.weigh(), crate.heavier(), crate.twice(), crate.handedOn(), crate.guarded(), crate.inLoop(3), crate.count);
}
const small = new Box("ab"), large = new Box("abcdefg");
const inner = new Crate(small, large);
const mixed = [new Crate(small, inner), new Crate(inner, small), new Crate(inner, inner), new Crate(small, large)];
for (let round = 0; round < 3; round++) for (const crate of mixed) show("round " + round, crate);
small.items = "abcd";
for (const crate of mixed) show("a box that grew", crate);
const bad = new Crate(new Box("ok"), inner);
(bad.left as Box).items = "boom";
console.log("a getter that throws", bad.guarded());
try { bad.weigh(); } catch (error) { console.log("and outside of a try", (error as Error).name); }
