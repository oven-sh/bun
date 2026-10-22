// Every object of a layout dies, a full collection runs, and the program makes objects of the layout again. A Structure that no object has ends at a full collection, so every round starts without one: at the allocation sites of compiled code, in the allocations of the run time (JSON.parse, spread, Object.assign), and under an object that only a frame holds while the collection runs.
const shell = globalThis as any;
const collectFull: () => void = shell.gc ?? (() => Bun.gc(true));
const collectYoung: () => void = shell.edenGC ?? require("bun:jsc").edenGC;

interface Point {
  x: number;
  y: number;
}

interface Named {
  name: string;
  tags: string[];
  point?: Point;
}

class Shape {
  sides: number;
  constructor(sides: number) {
    this.sides = sides;
  }
  area(): number {
    return 0;
  }
  describe(): string {
    return `${this.constructor.name} ${this.sides} ${this.area()}`;
  }
}

class Square extends Shape {
  edge: number;
  constructor(edge: number) {
    super(4);
    this.edge = edge;
  }
  area(): number {
    return this.edge * this.edge;
  }
}

function Counter(this: any, value: number) {
  this.value = value;
}
Counter.prototype.twice = function (this: any) {
  return this.value * 2;
};

const otherPrototype = { kind: "other" };

function readByName(object: any, key: string): unknown {
  return object[key];
}

function describe(object: any): string {
  const prototype = Object.getPrototypeOf(object);
  const inherits = prototype === Object.prototype ? "Object" : prototype === otherPrototype ? "other" : prototype.constructor.name;
  let listed = "";
  for (const key in object) listed += key + " ";
  return `${JSON.stringify(object)} [${Object.keys(object)}] (${listed.trim()}) ${inherits}`;
}

function createObjects(round: number): object[] {
  const point: Point = { x: round, y: round + 1 };
  const otherOrder: Point = { y: round, x: round + 1 };
  const named: Named = { name: "n" + round, tags: ["a", "b"] };
  const withPoint: Named = { name: "p" + round, tags: [], point };
  const withExtraProperty: any = { x: 1, y: 2 } as Point;
  withExtraProperty.z = round;
  const withOtherPrototype: Point = Object.setPrototypeOf({ x: round, y: 0 }, otherPrototype);
  const parsed = JSON.parse(`{"x":${round},"y":7}`) as Point;
  const spread: Point = { ...point, y: 9 };
  const assigned: Point = Object.assign({ x: 0, y: 0 }, point);
  return [point, otherOrder, named, withPoint, withExtraProperty, withOtherPrototype, parsed, spread, assigned, new Shape(round), new Square(round + 2), new (Counter as any)(round)];
}

function useObjects(round: number): string[] {
  const objects = createObjects(round);
  const lines = objects.map(describe);
  const square = objects[10] as Square;
  lines.push(`${square.describe()} ${square instanceof Shape} ${(objects[9] as Shape).describe()} ${(objects[11] as any).twice()}`);
  lines.push(`${readByName(objects[0], "x")} ${readByName(objects[4], "z")} ${readByName(objects[5], "kind")} ${readByName(objects[10], "edge")} ${readByName(objects[2], "point")}`);
  return lines;
}

function readBoth(point: Point): number {
  return point.x * 10 + point.y;
}

function holdInFrame(round: number): number {
  const point: Point = { x: round, y: round + 1 };
  const square = new Square(round);
  const before = readBoth(point) + square.area();
  collectFull();
  collectFull();
  return before + readBoth(point) + square.area() + (readByName(point, round % 2 ? "x" : "y") as number) + (readByName(square, "sides") as number);
}

function holdInFrameBelowOtherFrames(depth: number, round: number): number {
  const point: Point = { x: depth, y: round };
  const below = depth ? holdInFrameBelowOtherFrames(depth - 1, round) : holdInFrame(round);
  return below + readBoth(point);
}

const output: string[] = [];
for (let round = 0; round < 6; round++) {
  output.push(...useObjects(round));
  collectYoung();
  output.push(...useObjects(round + 100));
  collectFull();
  collectFull();
  output.push(String(holdInFrame(round)), String(holdInFrameBelowOtherFrames(5, round)));
  collectFull();
}
console.log(output.join("\n"));
