// Methods found through instances: structuredClone runs own getters and answers with a plain object, though lib.d.ts says that it returns what it was given: no method, no accessor and no class is left.
let total = 0;

class Point {
  constructor(public x: number, public y: number) {
    Object.defineProperty(this, "sum", { enumerable: true, get: (): number => ((total += 1000), this.x + this.y) });
  }
  norm(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }
  get double(): number {
    return this.x * 2;
  }
}

function measure(point: Point): number {
  if (point instanceof Point) return point.norm();
  const other = point as Point;
  return typeof other.norm === "function" ? 100 : 10 + other.x + (other.double === undefined ? 100000 : 0);
}

const point = new Point(1, 2);
total += measure(point);
const copy = structuredClone(point);
total += measure(copy);
const nested = structuredClone({ list: [point], map: new Map([["p", point]]) });
total += measure(nested.list[0]) + measure(nested.map.get("p")!);
console.log(total, Object.getPrototypeOf(copy) === Object.prototype, (copy as any).sum, nested.list[0] === nested.map.get("p"));
