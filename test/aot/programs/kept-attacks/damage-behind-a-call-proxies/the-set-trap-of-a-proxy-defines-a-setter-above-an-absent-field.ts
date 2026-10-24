// A typed caller reads an object, makes a call and reads it again. The set trap of a proxy, which a store to a property in the callee runs, defines a setter on the prototype object under the name of an optional field that the object does not have.
// `strike` reads a field of a typed object. In the rounds of the damage that object is one whose field has become an accessor, so the read leaves its typed path, goes by name and runs the getter, which does the damage.
class Card {
  id: number;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}
let caught = "";

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
    Object.defineProperty(Card.prototype, "note", {
      set(value: string) {
        caught += value;
      },
      configurable: true,
    });
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

const watched = new Proxy(
  { level: 1 },
  {
    set(target, key, value, receiver) {
      strike();
      return Reflect.set(target, key, value, receiver);
    },
  },
);
function callee(round: number): number {
  watched.level = round;
  return round & 3;
}

function holder(p: Card, round: number): string {
  const before = p.id + ":" + p.note;
  const got = callee(round);
  p.note = "mine";
  const after = p.note + "," + caught + "," + Object.keys(p).join("");
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
  p.note = "mine";
  const after = p.note + "," + caught + "," + Object.keys(p).join("");
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
  delete (Card.prototype as any).note;
}
console.log("digest " + digest);
