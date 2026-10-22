// `narrow` calls `wide` in tail position, and `wide` ends in a call in tail position too, so its typed body begins again in its generic version by a jump: three jumps hand on the return address of `holder`'s call.
// The first act of the generic version is to put the landing of that call in the place of its return address. Then it runs a getter that deletes a field of an object that only the callers hold.
// Build it a second time with --aot-disable=ChooseCallingConventions: then no caller reserves the stack words of a tail call, the thirteen arguments lie in a frame of their own,
// `wide` and its generic version return into the stub that drops that frame, and the address to replace is not the word on top of the stack but the one in the record of that frame.
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

function finish(sum: number, scale: number): number {
  return sum * scale + 0.25;
}

function wide(box: Box, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): number {
  const p = box.inner;
  const first = p.x * a + p.y * b + c * d - e * f;
  const second = g * h + i * j - k * l + p.x * 0.5;
  const third = Math.sqrt(first * first + second * second) + Math.abs(first - second) * 0.125;
  const fourth = (a + c + e + g + i + k) * 0.0625 - (b + d + f + h + j + l) * 0.03125;
  return finish(first + second + third + fourth, p.y * 0.5);
}

function narrow(box: Box, n: number): number {
  return wide(box, n + 0.5, n + 1.5, n + 2.5, n + 3.5, n + 4.5, n + 5.5, n + 6.5, n + 7.5, n + 8.5, n + 9.5, n + 10.5, n + 11.5);
}

function holder(q: Point, box: Box, n: number): string {
  const before = q.x + q.y;
  const got = narrow(box, n);
  return before + " " + got + " " + q.x + "," + q.y + "," + ("x" in q);
}

function outer(round: number, box: Box, strikes: boolean): string {
  const q = new Point(round + 0.5, round + 1);
  const before = q.x + q.y;
  if (strikes) victim = q;
  const inner = holder(q, box, round & 7);
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
