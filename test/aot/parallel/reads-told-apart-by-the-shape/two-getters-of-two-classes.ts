// STATISTIC: PropertyReadsDispatchedByShape >= 1
abstract class Disk { abstract get width(): number; }
class Coin extends Disk { constructor(public radius: number) { super(); } get width(): number { return this.radius * 2; } }
class Plate extends Disk { constructor(public across: number) { super(); } get width(): number { return this.across; } }
class Pair {
  constructor(readonly first: Disk, readonly second: Disk) {}
  span(): number { return this.first.width + this.second.width; }
  wider(): boolean { return this.first.width > this.second.width; }
}
const pairs = [new Pair(new Coin(2), new Plate(3)), new Pair(new Plate(5), new Coin(7)), new Pair(new Coin(1), new Coin(1))];
for (let round = 0; round < 3; round++) for (const pair of pairs) console.log("two getters", pair.span(), pair.wider());
(pairs[0]!.first as Coin).radius = 50;
for (const pair of pairs) console.log("a coin that grew", pair.span(), pair.wider());
