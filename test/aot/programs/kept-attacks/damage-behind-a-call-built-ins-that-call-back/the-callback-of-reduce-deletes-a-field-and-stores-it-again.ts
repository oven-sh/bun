// A typed caller reads an object, makes a call and reads it again. The callback of Array.prototype.reduce, which the callee calls, deletes a field of the object and stores it again, so that it is the last key.
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
  delete (target as any).x;
  target.x = 8;
  return true;
}

const steps = [1, 2, 3];
function callee(round: number): number {
  return steps.reduce((sum, step) => sum + (step === 3 && strike() ? 10 : step), 0) + (round & 3);
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
  if (round === 150 || round === 151 || round === 299) victim = p;
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
