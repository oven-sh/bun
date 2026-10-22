// A typed caller reads an object, makes a call and reads it again. The callback of Map.prototype.forEach, which the callee calls, stores a fraction into a field that has held only small integers, which its type allows.
// `strike` reads a field of a typed object. In the rounds of the damage that object is one whose field has become an accessor, so the read leaves its typed path, goes by name and runs the getter, which does the damage.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let victim: Point | null = null;
class Fuse {
  spark: number;
  constructor(spark: number) {
    this.spark = spark;
  }
}
const cold = new Fuse(0);
const lit = new Fuse(0);
let fuse: Fuse = cold;
Object.defineProperty(lit, "spark", {
  get(): number {
    fuse = cold;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    target.x = 0.5;
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

const table = new Map<string, number>([["a", 1], ["b", 2]]);
function callee(round: number): number {
  let sum = 0;
  table.forEach(value => {
    sum += value === 2 && strike() ? 10 : value;
  });
  return sum + (round & 3);
}

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round);
  const after = p.x * 2 + "," + (p.x | 0) + "," + p.y;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Point = new Point(round, round + 1);
  const before = p.x + p.y;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    fuse = lit;
  }
  const inner = holder(p, round);
  const after = p.x * 2 + "," + (p.x | 0) + "," + p.y;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
