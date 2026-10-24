// A typed caller reads an object, makes a call and reads it again. A getter, which a spread of its object in the callee runs, makes a field of the object an accessor.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
let reads = 0;
let stores = 0;

let victim: Point | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    Object.defineProperty(target, "x", {
      get() {
        reads++;
        return -7;
      },
      set(value: number) {
        stores += value;
      },
      enumerable: true,
      configurable: true,
    });
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

const source = {
  get level(): number {
    strike();
    return 1;
  },
};
function callee(round: number): number {
  return { ...source }.level + (round & 3);
}

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round);
  const first = p.x;
  p.x = 5;
  const after = first + "," + p.x + "," + p.y + "," + reads + "," + stores;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Point = new Point(round, round + 1);
  const before = p.x + p.y;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
  const inner = holder(p, round);
  const first = p.x;
  p.x = 5;
  const after = first + "," + p.x + "," + p.y + "," + reads + "," + stores;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
