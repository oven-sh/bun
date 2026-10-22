// A typed caller reads an object, makes a call and reads it again. A Symbol.hasInstance method, which an instanceof in the callee runs, stores -0 and a number beyond 32 bits into fields that have held only small integers, which their type allows.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let victim: Point | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  target.x = -0;
  target.y = 2 ** 40 + 1;
  return true;
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

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round);
  const after = 1 / p.x + "," + Object.is(p.x, -0) + "," + p.y;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Point = new Point(round, round + 1);
  const before = p.x + p.y;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  const after = 1 / p.x + "," + Object.is(p.x, -0) + "," + p.y;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
