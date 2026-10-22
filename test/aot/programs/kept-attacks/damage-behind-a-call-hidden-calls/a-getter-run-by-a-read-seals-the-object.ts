// A typed caller reads an object, makes a call and reads it again. A getter, which a read of a property in the callee runs, seals the object, which has an optional field that is not there yet.
// `strike` reads a field of a typed object. In the rounds of the damage that object is one whose field has become an accessor, so the read leaves its typed path, goes by name and runs the getter, which does the damage.
class Card {
  id: number;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

let victim: Card | null = null;
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
    Object.seal(target);
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

class Gauge {
  level = 1;
  get reading(): number {
    strike();
    return this.level;
  }
}
const gauge = new Gauge();
function callee(round: number): number {
  return gauge.reading + (round & 3);
}

function holder(p: Card, round: number): string {
  const before = p.id + ":" + p.note;
  const got = callee(round);
  let stored = "stored";
  try {
    p.note = "late";
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p.note + "," + p.id + "," + Object.keys(p).join("");
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Card = new Card(round);
  const before = p.id + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    fuse = lit;
  }
  const inner = holder(p, round);
  let stored = "stored";
  try {
    p.note = "late";
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p.note + "," + p.id + "," + Object.keys(p).join("");
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
