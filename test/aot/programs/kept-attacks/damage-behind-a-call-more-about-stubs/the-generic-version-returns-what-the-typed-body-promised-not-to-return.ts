// The typed body promises its callers a Point and tests what it cannot prove. Before it has done anything it finds the state of an object changed and begins again in its generic version, which returns in its place.
// The generic version hands back the second argument, which is no Point in some rounds. The caller tests no result at its plain return point, so that value has to arrive at the landing:
// either the generic version sends its return there, or it keeps the promise of the typed body by itself. A generic version that does neither hands a number to code that reads fields in place.
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

function pick(box: Box, other: any, steps: number): Point {
  const p = box.inner;
  let sum = p.x * 0.5 + p.y * 0.25;
  for (let step = 1; step <= steps; step++) {
    const a = p.x * step + 0.125;
    const b = p.y / step - 0.375;
    const c = a * a - b * b + a * b * 0.5;
    const d = Math.sqrt(a * a + b * b) + Math.abs(c) * 0.0625;
    sum += (a + b + c + d) * 0.03125 - Math.floor(d) + (d > c ? a : b) * 0.015625;
  }
  return sum > 1000 ? p : other;
}

function holder(box: Box, other: any): string {
  const got = pick(box, other, 3);
  return got.x + "," + got.y;
}

function outer(box: Box, other: any): string {
  const first = holder(box, other);
  const second = holder(box, other);
  return first + " " + second;
}

const calm = new Box(new Point(2, 4));
const trapped = new Box(new Point(2, 4));
Object.defineProperty(trapped.inner, "x", { get: () => 2, enumerable: true, configurable: true });

const fits = new Point(7, 8);
const misfits: any[] = [7, "text", { y: 1 }, [1, 2], true, null === undefined, 0.5, { x: "a", y: "b", z: "c" }];

let digest = 0;
for (let round = 0; round < 400; round++) {
  const restarts = round % 50 >= 48;
  const lies = round % 100 === 49 || round % 100 === 97;
  const other = lies ? misfits[(round >> 4) % misfits.length] : fits;
  const line = outer(restarts ? trapped : calm, other);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || restarts || lies) console.log(round + ": " + line);
}
console.log("digest " + digest);
