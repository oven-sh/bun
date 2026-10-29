// `--conditions` holds for the types of an import as it does for its code, as under `bun build --check`: a package that has a file only under the condition is found, and one that has built files too is typed by the sources that run. So it is in a folder under a tsconfig.json of its own.
// Flags: --conditions=source
// Reference: bun build --compile
import { makePair, origin, swap, type Pair } from "built-too";
import { double, Point } from "only-sources";
import { difference } from "./tools/sum.ts";

function sumPoint(p: Point): number {
  return p.x + p.y;
}

function sumPair(p: Pair): number {
  return p.first + p.second;
}

const point = new Point(1, -2);
const pair = makePair(3, 4);
console.log(origin, sumPoint(point), point.norm(), double(21), sumPair(pair), sumPair(swap(pair)), difference(pair));

const untyped: any[] = [point, pair, { x: "a", y: "b", first: "c", second: "d" }];
console.log(sumPoint(untyped[0]), sumPair(untyped[1]), sumPoint(untyped[2]), sumPair(untyped[2]));
