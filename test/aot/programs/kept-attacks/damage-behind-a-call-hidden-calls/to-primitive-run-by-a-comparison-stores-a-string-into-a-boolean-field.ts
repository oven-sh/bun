// A typed caller reads an object, makes a call and reads it again. A Symbol.toPrimitive method, which a comparison in the callee runs, stores a string into a boolean field of the object.
// `strike` reads a field of a typed object. In the rounds of the damage that object is one whose field has become an accessor, so the read leaves its typed path, goes by name and runs the getter, which does the damage.
class Lamp {
  on: boolean;
  watts: number;
  constructor(on: boolean, watts: number) {
    this.on = on;
    this.watts = watts;
  }
}

let victim: Lamp | null = null;
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
    (target as any).on = "no";
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

const limit: any = {
  [Symbol.toPrimitive](): number {
    strike();
    return 100;
  },
};
function callee(round: number): number {
  return round < limit ? 1 : 2;
}

function holder(p: Lamp, round: number): string {
  const before = (p.on ? "lit" : "dark") + p.watts;
  const got = callee(round);
  const after = (p.on ? "lit" : "dark") + "," + (p.on === true) + "," + (p.on === false) + "," + typeof p.on + "," + p.watts;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Lamp = new Lamp((round & 1) === 0, round);
  const before = (p.on ? "lit" : "dark") + p.watts;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    fuse = lit;
  }
  const inner = holder(p, round);
  const after = (p.on ? "lit" : "dark") + "," + (p.on === true) + "," + (p.on === false) + "," + typeof p.on + "," + p.watts;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
