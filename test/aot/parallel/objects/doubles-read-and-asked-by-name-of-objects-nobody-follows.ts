// Most names of this program hold numbers that are not all integers, so its stubs ask for a double early. Every other kind of field and every kind of double still answers.
const hidden = String(Date.now()).slice(99);
class Point {
  x: number;
  y: number;
  z: number;
  label: string | undefined;
  on: boolean;
  next: Point | null;
  rare?: number;
  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.label = x > 1 ? "big" : undefined;
    this.on = x > 0;
    this.next = null;
  }
}

const values = [0.5, -0.5, 0, -0, 1e300, 2 ** 31, 3, NaN, Infinity, -Infinity];
const points = values.map(value => new Point(value, value * 2, 1 / value));
points[1].next = points[0];
points[2].rare = 1.5;
delete (points[3] as any).y;
(points[4] as any).x = "now a string";
Object.defineProperty(points[5], "z", { get: () => 0.25, configurable: true });
const others: any[] = [{ x: 1.5 }, { y: 2 }, Object.create({ x: "inherited", z: 2.5 }), [1], "text"];
const everything: any[] = [...points, ...others];
const holder: any = {};
holder["list" + hidden] = everything;

function read(item: any, name: "x" | "y" | "z" | "label" | "on" | "next" | "rare") {
  switch (name) {
    case "x":
      return item.x;
    case "y":
      return item.y;
    case "z":
      return item.z;
    case "label":
      return item.label;
    case "on":
      return item.on;
    case "next":
      return item.next === null ? "null" : typeof item.next;
    case "rare":
      return item.rare;
  }
}

const names = ["x", "y", "z", "label", "on", "next", "rare"] as const;
let present = 0;
let sum = 0;
for (let round = 0; round < 3000; round++) {
  for (const item of holder.list) {
    if (typeof item !== "object") continue;
    if ("x" in item) present++;
    if ("y" in item) present++;
    if ("z" in item) present++;
    if ("rare" in item) present++;
    if ("missing" in item) present += 1000;
    const x = item.x;
    if (typeof x === "number" && x === x && Math.abs(x) < 1e9) sum += x;
  }
}
console.log(present, sum);
for (const item of holder.list) {
  const row = names.map(name => {
    const value = typeof item === "object" ? read(item, name) : read(Object(item), name);
    return Object.is(value, -0) ? "-0" : String(value);
  });
  console.log(row.join(" "));
}
