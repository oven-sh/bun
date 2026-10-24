interface Point {
  x: number;
  y: number;
  label: string;
}

function pick(flag: boolean, a: Point, b: Point): Point {
  return flag ? a : b;
}

function first(a: any): any {
  if (typeof a === "object" && a !== null) return a;
  return a;
}

function eight(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number {
  return ((a << (b & 7)) + (c >> (d & 7)) + ((e | 0) % ((f | 0) || 1)) + Math.imul(g, h)) | 0;
}

function tenMixed(a: Point, b: number, c: string, d: Point, e: number, f: boolean, g: any, h: Point, i: number, j: string): string {
  return a.label + b + c + d.x + e + f + String(g) + h.y + i + j;
}

function shifts(value: number, count: number, other: number, mask: number): number {
  let total = 0;
  for (let i = 0; i < 5; i++) total = (total + ((value << count) ^ (other >>> (count + i)) ^ (mask >> i))) | 0;
  return total;
}

function divides(a: number, b: number, c: number, d: number): number {
  const q = ((a | 0) / ((b | 0) || 1)) | 0;
  const r = (c | 0) % ((d | 0) || 1);
  return q * 31 + r + a - d;
}

function doubles(a: number, b: number, c: number, d: number): number {
  return a * 1.5 + b / 2.5 - c * d + Math.sqrt(a * a + b * b);
}

function usedBeforeAndAfter(a: Point, b: Point, c: number): string {
  const before = a.x + b.y + c;
  const made = pick(c > 2, a, b);
  return before + made.label + a.label + b.label + c;
}

function usedOnlyBefore(a: Point, b: Point, c: number): string {
  const sum = a.x * b.y + c;
  return describe(sum);
}

function describe(value: number): string {
  return "<" + value + ">";
}

function resultUsedAtOnce(a: Point, b: Point): number {
  const p = pick(a.x > b.x, a, b);
  if (p.x > 10) return p.y;
  return p.x + p.y;
}

function resultKept(a: Point, b: Point): string {
  const p = pick(a.x > b.x, a, b);
  const q = pick(a.y > b.y, a, b);
  return p.label + q.label + p.x + q.y;
}

function inALoop(points: Point[], scale: number, offset: number, label: string): string {
  let out = label;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    out += (p.x * scale + offset) + ",";
    if (p.y > 4) out += describe(p.y);
  }
  return out + scale + offset + label;
}

function loopWithoutCalls(a: number, b: number, c: number, d: number): number {
  let total = 0;
  for (let i = 0; i < 100; i++) total = (total + a * i + (b ^ i) - (c & i) + d) | 0;
  return total;
}

function passedOnInPlace(a: Point, b: Point, c: number): string {
  return usedBeforeAndAfter(a, b, c);
}

function passedOnSwapped(a: Point, b: Point, c: number): string {
  return usedBeforeAndAfter(b, a, c + 1);
}

function throwsLate(a: Point | undefined, b: Point): number {
  const base = b.x;
  return base + a!.y;
}

function manyBranches(a: any, b: any, c: any): string {
  if (a === undefined) return "u" + b;
  if (a === null) return "n" + c;
  if (typeof a === "number") return a > 0 ? "p" + b : "m" + c;
  if (typeof a === "string") return a + b + c;
  return String(first(a) === a) + b + c;
}

const p1: Point = { x: 1, y: 2, label: "one" };
const p2: Point = { x: 30, y: 4.5, label: "two" };
const p3: Point = { x: -5, y: 60, label: "three" };

console.log(pick(true, p1, p2).label, pick(false, p1, p2).label);
console.log(first(p1) === p1, first(5), first("s"), first(null), first(undefined), first(2.5));
console.log(eight(1, 2, 300, 4, 50, 6, 7, 8), eight(-1, 31, -300, 33, -50, 0, 70000, 80000));
console.log(tenMixed(p1, 2, "c", p2, 5.5, true, null, p3, 9, "j"));
console.log(shifts(5, 3, -77, 1 << 20), shifts(-5, 33, 77, -1));
console.log(divides(100, 7, 55, 9), divides(-100, 0, -55, 0), divides(2 ** 31, 3, 2 ** 32 + 5, 4));
console.log(doubles(1, 2, 3, 4), doubles(0.5, -0.25, 1e10, 1e-10));
console.log(usedBeforeAndAfter(p1, p2, 3), usedBeforeAndAfter(p3, p1, 1));
console.log(usedOnlyBefore(p1, p2, 3), usedOnlyBefore(p3, p2, 0.5));
console.log(resultUsedAtOnce(p1, p2), resultUsedAtOnce(p3, p1), resultKept(p1, p2), resultKept(p3, p2));
console.log(inALoop([p1, p2, p3], 2, 0.5, "L"), loopWithoutCalls(3, 5, 7, 11));
console.log(passedOnInPlace(p1, p3, 2), passedOnSwapped(p1, p3, 2));
try {
  console.log(throwsLate(p1, p2));
  console.log(throwsLate(undefined, p2));
} catch (error) {
  console.log((error as Error).constructor.name);
}
for (const a of [undefined, null, 1, -1, "s", p1, [1]]) console.log(manyBranches(a, "b", 3));
