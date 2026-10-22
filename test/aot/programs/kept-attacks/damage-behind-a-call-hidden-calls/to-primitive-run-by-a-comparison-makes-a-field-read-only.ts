// A typed caller reads an object, makes a call and reads it again. A Symbol.toPrimitive method, which a comparison in the callee runs, makes a field of the object read-only.
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
  Object.defineProperty(target, "x", { value: 41, writable: false });
  return true;
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

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round);
  let stored = "stored";
  try {
    p.x = 5;
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p.x + "," + p.y;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Point = new Point(round, round + 1);
  const before = p.x + p.y;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  let stored = "stored";
  try {
    p.x = 5;
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p.x + "," + p.y;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
