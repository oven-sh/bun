// A typed caller reads an object, makes a call and reads it again. A Symbol.hasInstance method, which an instanceof in the callee runs, deletes a field of the inner object, which the caller has read out of a field and still holds.
// `strike` reads a field of a typed object. In the rounds of the damage that object is one whose field has become an accessor, so the read leaves its typed path, goes by name and runs the getter, which does the damage.
class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
class Branch {
  leaf: Leaf;
  weight: number;
  constructor(leaf: Leaf, weight: number) {
    this.leaf = leaf;
    this.weight = weight;
  }
}

let victim: Branch | null = null;
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
    delete (target.leaf as any).value;
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

class Judge {
  static [Symbol.hasInstance](value: unknown): boolean {
    strike();
    return typeof value === "number";
  }
}
function callee(round: number): number {
  return (round as any) instanceof Judge ? round & 3 : -1;
}

function holder(p: Branch, round: number): string {
  const leaf = p.leaf;
  const before = leaf.value + p.weight;
  const got = callee(round);
  let through: string;
  try {
    through = String(p.leaf.value);
  } catch (error) {
    through = (error as Error).name;
  }
  const after = through + "," + leaf.value + "," + (p.leaf === leaf) + "," + p.weight;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Branch = new Branch(new Leaf(round), round + 1);
  const leaf = p.leaf;
  const before = leaf.value + p.weight;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    fuse = lit;
  }
  const inner = holder(p, round);
  let through: string;
  try {
    through = String(p.leaf.value);
  } catch (error) {
    through = (error as Error).name;
  }
  const after = through + "," + leaf.value + "," + (p.leaf === leaf) + "," + p.weight;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
