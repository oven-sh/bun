// A compiled file is loaded once more from disk, under a query that the build cannot read, and that copy runs from source. Its class, its objects and its functions look like
// those of the compiled file and are not: where a Box is expected an object of the copy finds the copy's methods, a function of the copy is not the compiled one,
// and the function in a field of an object of the copy is the copy's.
// Flags: --aot-allow-code-from-disk --compile-in-place
import { Box, half, load, make, twice } from "./shapes.ts";

const copy: typeof import("./shapes.ts") = await import(Buffer.from("./shapes.ts?again").toString());

function width(box: Box): number {
  return box.w;
}

function area(box: Box): number {
  return box.area();
}

function grower(box: Box): (by: number) => number {
  return box.grow;
}

function getter(made: ReturnType<typeof make>): () => number {
  return made.get;
}

function isHalf(f: unknown): boolean {
  return f === half;
}

function isTwice(f: unknown): boolean {
  return f === twice;
}

function isBox(value: unknown): boolean {
  return value instanceof Box;
}

console.log(load, copy.load, copy.Box === Box);

const mine = new Box(2, 3);
const theirs = new copy.Box(4, 5);
for (const box of [mine, theirs, mine, theirs])
  console.log(width(box), area(box), grower(box)(1), grower(box) === box.grow, isBox(box), box instanceof copy.Box);
console.log(grower(mine) === grower(theirs));

console.log(isHalf(half), isHalf(copy.half), isTwice(twice), isTwice(copy.twice));
console.log(half(theirs), copy.half(mine), twice(theirs), copy.twice(mine));

const made = make(1);
const madeByCopy = copy.make(2);
for (const object of [made, madeByCopy, made, madeByCopy]) console.log(getter(object)(), getter(object) === object.get, object.me());
console.log(getter(made) === getter(madeByCopy));
