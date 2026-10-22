// A typed caller reads an object, makes a call and reads it again. A function that then throws. The caller itself catches. That function stores a string into a number field of the object, which an object literal has made.
// `strike` reads a field of a typed object. In the rounds of the damage that object is one whose field has become an accessor, so the read leaves its typed path, goes by name and runs the getter, which does the damage.
type Pair = { left: number; right: number; note?: string };

let victim: Pair | null = null;
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
    (target as any).right = "text";
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

function risky(): void {
  if (strike()) throw new Error("behind the damage");
}
function callee(round: number): number {
  risky();
  return round & 3;
}

function holder(p: Pair, round: number): string {
  const before = p.left + p.right + ":" + p.note;
  let got: number;
  try {
    got = callee(round);
  } catch {
    got = -1;
  }
  const after = p.left + "," + (p.right + 1) + "," + typeof p.right;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Pair = { left: round, right: round + 1 };
  const before = p.left + p.right + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    fuse = lit;
  }
  const inner = holder(p, round);
  const after = p.left + "," + (p.right + 1) + "," + typeof p.right;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
