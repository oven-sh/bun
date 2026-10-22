// Object.setPrototypeOf changes single instances: to an object that has the name, to an object with accessors, to null, to another class's prototype, and back.
// Their neighbors of the same class go through the same typed functions in the same loop and must not be disturbed.
class Point {
  declare x: number;
  declare label?: string;
  constructor(x: number) {
    this.x = x;
  }
}
class Other {
  declare y: number;
  get label() {
    return "label of Other";
  }
  set label(value: string) {
    log.push("Other gets " + value);
  }
}
const log: string[] = [];
function read(point: Point) {
  return point.label;
}
function write(point: Point, value: string) {
  point.label = value;
}
function state(point: Point) {
  return `${read(point)} ${"label" in point} ${Object.hasOwn(point, "label")} ${point instanceof Point}`;
}
function readLinkRead(point: Point, above: object | null) {
  const before = point.label;
  Object.setPrototypeOf(point, above);
  return `${before} ${point.label}`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const point = new Point(i);
  length += read(point)?.length ?? 1;
  if (i & 1) write(point, "ab");
  length += read(point)?.length ?? 1;
}
console.log("warm", length);

const points: Point[] = [];
for (let i = 0; i < 10; i++) points.push(new Point(i));
console.log("data:", readLinkRead(points[1], { label: "inherited" }));
console.log(
  "accessors:",
  readLinkRead(points[2], {
    get label() {
      return "computed";
    },
    set label(value: string) {
      log.push("literal gets " + value);
    },
  }),
);
console.log("null:", readLinkRead(points[3], null));
console.log("another class:", readLinkRead(points[4], Other.prototype));
console.log("an heir of the class's prototype:", readLinkRead(points[5], Object.create(Point.prototype, { label: { value: "of the heir", writable: false } })));
console.log("the same prototype again:", readLinkRead(points[6], Point.prototype));
(points[7] as any).__proto__ = { label: "by a store to __proto__" };
Reflect.setPrototypeOf(points[8], { label: "by Reflect.setPrototypeOf" });
console.log(points.map(state).join(" | "));
const outcomes = points.map((point, index) => {
  try {
    write(point, "w" + index);
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
});
console.log(outcomes.join(), "|", log.join(", "));
console.log(points.map(state).join(" | "));
console.log(points.map(point => Object.keys(point).join("+")).join(" | "));
for (const point of points) {
  delete point.label;
  Object.setPrototypeOf(point, Point.prototype);
}
console.log("all put back:", points.map(state).join(" | "));
for (const point of points) write(point, "again");
console.log(points.map(state).join(" | "), log.length);
