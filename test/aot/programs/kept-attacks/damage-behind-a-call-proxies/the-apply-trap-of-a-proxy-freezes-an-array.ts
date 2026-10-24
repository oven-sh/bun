// A typed caller reads an array, makes a call and reads it again. The apply trap of a proxy around a function, which a call in the callee runs, freezes the array.
// `strike` reads a field of a typed object. In the rounds of the damage that object is one whose field has become an accessor, so the read leaves its typed path, goes by name and runs the getter, which does the damage.

let victim: number[] | null = null;
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
    Object.freeze(target);
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

const watched = new Proxy((round: number) => round & 3, {
  apply(target, thisValue, list) {
    strike();
    return Reflect.apply(target, thisValue, list);
  },
});
function callee(round: number): number {
  return watched(round) + 1;
}

function holder(p: number[], round: number): string {
  const before = p[0] + p[3] + p.length;
  const got = callee(round);
  let stored = "stored";
  try {
    p[0] = 9;
    p.push(1);
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p[0] + "," + p.length;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: number[] = [round, round + 1, round + 2, round + 3];
  const before = p[0] + p[3] + p.length;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    fuse = lit;
  }
  const inner = holder(p, round);
  let stored = "stored";
  try {
    p[0] = 9;
    p.push(1);
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p[0] + "," + p.length;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
