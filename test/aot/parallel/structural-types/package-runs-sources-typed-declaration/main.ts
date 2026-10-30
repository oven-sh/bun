// The `bun` condition of a package names its TypeScript source, which runs. `types` names the declaration file, which the importer sees. A parameter typed with the package's class is tested once, at the entry.
// IRT= 0 sumPoint = TypeTest
// IRT= 2 sumPoint = GetSlot v\d+ key="[xy]" receivers=\[L\d+\] level=Proven
// IRT= 0 callNorm = TypeTest
// IRT= 1 sumPair = TypeTest
import { Point, makePoint, makePair, which, type Pair } from "lib";
class Text { x = "s"; y = "t"; norm(): string { return "n"; } }
class Wide { a = 1; b = 2; c = 3; x = 4.5; y = 5.5; norm(): number { return 1.5; } }
const bag: any[] = [];
for (let i = 0; i < 64; i++) {
  bag.push(i & 1 ? makePoint(i) : new Point(i, 2), makePair(i), new Text(), new Wide(), { first: "f", second: "s", x: null }, "text");
}
function sumPoint(p: Point): number { return p.x + p.y; }
function sumPair(p: Pair): number { return p.first + p.second; }
function callNorm(p: Point): number { return p.norm(); }
let total = 0;
const rounds = Number(process.argv[2] ?? 1);
for (let r = 0; r < rounds; r++) {
  for (let i = 0; i < 64; i++) {
    total += sumPoint(bag[i * 6]) + sumPair(bag[i * 6 + 1]) + callNorm(bag[i * 6]);
  }
  total &= 0xffffff;
}
console.log(which, total, bag[6] instanceof Point, bag[2].norm(), bag[3].norm(), bag[4].first, bag[5]);
