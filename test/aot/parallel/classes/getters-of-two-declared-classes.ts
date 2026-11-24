// STATISTIC: PropertyReadsDispatchedByShape >= 2
// STATISTIC: GettersCalledByClass = 0
// Where the classes are declared and few, no read as written stands beside the getters of the classes.
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
const widest = (disks: Disk[]): number => { let most = 0; for (const disk of disks) if (disk.width > most) most = disk.width; return most; };
const disks: Disk[] = pairs.flatMap(pair => [pair.first, pair.second]);
for (let round = 0; round < 40; round++) { disks.push(round & 1 ? new Coin(round) : new Plate(round)); if (round % 8 === 0) console.log("widest", widest(disks)); }
Object.defineProperty(Plate.prototype, "width", { configurable: true, get(this: Plate) { return this.across + 1000; } });
console.log("replaced", widest(disks), pairs.map(pair => pair.span()).join());
Object.defineProperty(disks[1]!, "width", { configurable: true, value: 5000 });
console.log("hidden", widest(disks), pairs.map(pair => pair.span()).join());
