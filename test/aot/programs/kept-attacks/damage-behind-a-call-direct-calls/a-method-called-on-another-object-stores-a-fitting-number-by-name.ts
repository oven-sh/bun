// A typed caller reads an object, makes a call and reads it again. A method of another object, which the callee calls, stores a number into a field of the object by a computed name, so that nothing about the object changes but the value.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
const names = ["x", "y"];

let victim: Point | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    (target as any)[names[0]] = 1000;
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

class Clerk {
  done = 0;
  work(round: number): number {
    strike();
    return ++this.done + round;
  }
}
const clerk = new Clerk();
function callee(round: number): number {
  return clerk.work(round) & 3;
}

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round);
  const after = p.x + "," + p.y;
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
  const after = p.x + "," + p.y;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
