// A typed caller reads an object, makes a call and reads it again. The getPrototypeOf trap of a proxy, which an instanceof in the callee runs, deletes a field of the object and stores it again, so that it is the last key.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let victim: Point | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    delete (target as any).x;
    target.x = 8;
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

class Marker {}
const watched = new Proxy(new Marker(), {
  getPrototypeOf(target) {
    strike();
    return Reflect.getPrototypeOf(target);
  },
});
function callee(round: number): number {
  return watched instanceof Marker ? round & 3 : -1;
}

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round);
  let keys = "";
  for (const key in p) keys += key;
  const after = p.x + "," + p.y + "," + keys;
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
  let keys = "";
  for (const key in p) keys += key;
  const after = p.x + "," + p.y + "," + keys;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
