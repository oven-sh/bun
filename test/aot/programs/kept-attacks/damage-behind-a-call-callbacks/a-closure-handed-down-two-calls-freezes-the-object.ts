// A typed caller reads an object, makes a call and reads it again. A closure that the caller makes and that is handed down two calls freezes the object.
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
  Object.freeze(target);
  return true;
}

function inner(action: (step: number) => number): number {
  return action(1) + action(2);
}
function callee(round: number, action: (step: number) => number): number {
  return inner(action) + (round & 3);
}

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round, step => (step === 2 && strike() ? 10 : step));
  let stored = "stored";
  try {
    p.x = 5;
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p.x + "," + p.y + "," + Object.isFrozen(p);
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
  const after = stored + "," + p.x + "," + p.y + "," + Object.isFrozen(p);
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
