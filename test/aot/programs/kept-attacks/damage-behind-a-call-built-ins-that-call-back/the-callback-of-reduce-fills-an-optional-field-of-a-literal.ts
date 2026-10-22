// A typed caller reads an object, makes a call and reads it again. The callback of Array.prototype.reduce, which the callee calls, fills an optional field of the object, which an object literal has made without it, in typed code.
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
    target.note = "filled";
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

const steps = [1, 2, 3];
function callee(round: number): number {
  return steps.reduce((sum, step) => sum + (step === 3 && strike() ? 10 : step), 0) + (round & 3);
}

function holder(p: Pair, round: number): string {
  const before = p.left + p.right + ":" + p.note;
  const got = callee(round);
  const after = p.note + "," + p.left + "," + Object.keys(p).join("");
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
  const after = p.note + "," + p.left + "," + Object.keys(p).join("");
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
