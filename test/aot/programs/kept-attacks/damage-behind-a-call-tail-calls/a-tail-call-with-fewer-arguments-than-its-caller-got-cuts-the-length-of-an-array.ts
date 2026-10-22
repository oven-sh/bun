// A typed caller reads an array, makes a call and reads it again. A function with one parameter, which the callee with twelve parameters calls in tail position, cuts the length of the array.
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
    target.length = 1;
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

function narrow(n: number): number {
  strike();
  return n & 7;
}
function callee(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): number {
  return narrow(a + b + c + d + e + f + g + h + i + j + k + l);
}

function holder(p: number[], round: number): string {
  const before = p[0] + p[3] + p.length;
  const got = callee(round, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
  let sum = 0;
  for (let index = 0; index < p.length; index++) sum += p[index];
  const after = sum + "," + p.length + "," + p[1] + "," + p[3];
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
  let sum = 0;
  for (let index = 0; index < p.length; index++) sum += p[index];
  const after = sum + "," + p.length + "," + p[1] + "," + p[3];
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
