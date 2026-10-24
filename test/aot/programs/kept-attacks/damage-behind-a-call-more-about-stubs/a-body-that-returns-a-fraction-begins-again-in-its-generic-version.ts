// A typed body reads an object out of a typed field and finds its state changed before it has done anything, so the call begins again in the generic version.
// The body returns a fraction in a register of its own and the generic version returns a boxed value: the restart is a call and a return, not a jump.
// The generic version reads by name and runs a getter, which deletes a field of ANOTHER object: one that the two callers above hold proven and never hand down.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class Box {
  inner: Point;
  constructor(inner: Point) {
    this.inner = inner;
  }
}

let victim: Point | null = null;
function strike(): void {
  const target = victim;
  if (target === null) return;
  victim = null;
  delete (target as any).x;
}

function weigh(box: Box, steps: number): number {
  const p = box.inner;
  let sum = p.x * 0.5 + p.y * 0.25;
  for (let step = 1; step <= steps; step++) {
    const a = p.x * step + 0.125;
    const b = p.y / step - 0.375;
    const c = a * a - b * b + a * b * 0.5;
    const d = Math.sqrt(a * a + b * b) + Math.abs(c) * 0.0625;
    const e = (a + b + c + d) * 0.03125 - (a - b) * (c - d) * 0.001953125;
    sum += e - Math.floor(e) + (d > c ? a : b) * 0.015625;
  }
  return sum;
}

function holder(q: Point, box: Box): string {
  const before = q.x + q.y;
  const got = weigh(box, 3);
  return before + " " + got + " " + q.x + "," + q.y + "," + ("x" in q);
}

function outer(round: number, box: Box, strikes: boolean): string {
  const q = new Point(round + 0.5, round + 1);
  const before = q.x + q.y;
  if (strikes) victim = q;
  const inner = holder(q, box);
  return before + " [" + inner + "] " + q.x + "," + q.y + "," + ("x" in q);
}

const calm = new Box(new Point(2, 4));
const trapped = new Box(new Point(2, 4));
Object.defineProperty(trapped.inner, "x", {
  get() {
    strike();
    return 2;
  },
  enumerable: true,
  configurable: true,
});

let digest = 0;
for (let round = 0; round < 400; round++) {
  const strikes = round === 150 || round === 151 || round === 399;
  const restarts = strikes || round % 50 === 49;
  const line = outer(round, restarts ? trapped : calm, strikes);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || restarts) console.log(round + ": " + line);
}
console.log("digest " + digest);
