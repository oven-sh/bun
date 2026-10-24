// NOTHING IS DAMAGED HERE AND EVERY RESULT FITS ITS DECLARED TYPE. The callee returns a Leaf or a Fork, one as often as the other, and its caller asks at once which of the two it got.
// That test stands right behind the call and names LESS than the callee declares. Code generation takes any type in the test of a call with a landing: where the callee promises no subset of it, the test is made
// at the plain return point and what fails takes the landing edge. So if a pass ever takes such a test for the test of the form, every Fork means BecomeDirty in `weigh`, then a landing in `holder`, then one in `walk`,
// on every second call of a program that never leaves its typed paths. PlaceLandings as staged takes only a test for the declared type or a wider one (isFollowedByTestOfPromisedType): this program keeps it so.
// The answers are the same either way. WHAT TO LOOK AT: instructions with and without --aot-disable=CleanReturns, and how often the stub BecomeDirty is entered: it has to be 0.
class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
class Fork {
  left: number;
  right: number;
  constructor(left: number, right: number) {
    this.left = left;
    this.right = right;
  }
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const leaves: Leaf[] = [];
const forks: Fork[] = [];
for (let index = 0; index < 8; index++) {
  leaves.push(new Leaf(index));
  forks.push(new Fork(index, index * 2));
}

// It calls itself, so it stays a call.
function choose(n: number, depth: number): Leaf | Fork {
  if (depth > 0) return choose(n + 1, depth - 1);
  return (n & 1) === 0 ? leaves[n & 7] : forks[n & 7];
}

function weigh(n: number): number {
  const got = choose(n, 2);
  if (got instanceof Leaf) return got.value;
  return got.left + got.right;
}

// The same with a result that may be missing: the use needs a Leaf, the callee declares `Leaf | undefined`, and the narrower test goes first.
function find(n: number, depth: number): Leaf | undefined {
  if (depth > 0) return find(n + 1, depth - 1);
  return (n & 3) === 0 ? undefined : leaves[n & 7];
}

function valueOrZero(n: number): number {
  const got = find(n, 2);
  if (got === undefined) return 0;
  return got.value;
}

function holder(p: Point, n: number): number {
  const before = p.x;
  const weight = weigh(n) + valueOrZero(n);
  return before + weight + p.x + p.y;
}

function walk(p: Point, from: number, to: number): number {
  let sum = 0;
  for (let n = from; n < to; n++) sum = (sum + holder(p, n)) % 1000003;
  return sum + p.x;
}

const point = new Point(3, 4);
let total = 0;
for (let round = 0; round < 200; round++) total = (total + walk(point, round, round + 10000)) % 1000003;
console.log(total);
