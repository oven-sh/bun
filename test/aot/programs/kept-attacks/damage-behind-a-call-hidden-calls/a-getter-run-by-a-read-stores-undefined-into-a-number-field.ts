// A typed caller reads an object, makes a call and reads it again. A getter, which a read of a property in the callee runs, stores undefined into a number field of the object.
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
  (target as any).x = undefined;
  return true;
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

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round);
  const after = (p.x + 1) + "," + (p.x === undefined) + "," + ("x" in p) + "," + p.y;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Point = new Point(round, round + 1);
  const before = p.x + p.y;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  const after = (p.x + 1) + "," + (p.x === undefined) + "," + ("x" in p) + "," + p.y;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
