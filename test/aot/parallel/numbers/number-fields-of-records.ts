// Records whose fields are written `number` and reckoned with: made by literals, parsed, copied and cloned, with values of every kind in those fields.
const lines: string[] = [];
interface Point {
  x: number;
  y: number;
  name: string;
}
interface Labels {
  x: string;
  y: string;
  name: string;
}
interface Maybe {
  x?: number;
  y: number | null;
  name: string;
}
interface Node2 {
  weight: number;
  next: Node2 | null;
}
function step(p: Point, by: number): number {
  p.x += p.y * by;
  p.y = -p.y * 0.5;
  return p.x * p.y;
}
function half(p: Maybe): number {
  return (p.x ?? 3) * 0.5 + (p.y ?? 1) * 2;
}
function sum(node: Node2 | null): number {
  let s = 0;
  for (; node; node = node.next) s += node.weight * 1.5;
  return s;
}
const made: [string, (x: any, y: any) => any][] = [
  ["literal", (x, y) => ({ x, y, name: "l" }) as Point],
  ["converted", (x, y) => ({ x: +x, y: x - y, name: "c" }) as Point],
  ["text", (x, y) => ({ x: `${String(x)}!`, y: "" + String(y), name: "t" }) as Labels],
  ["written", () => ({ x: 4, y: 0.25, name: "w" }) as Point],
  ["parsed", (x, y) => Object.assign(JSON.parse('{"x":1.5,"y":2,"name":"p"}'), { x, y })],
  ["copied", (x, y) => ({ ...({ x, y, name: "a" } as Point), name: "b" })],
  ["assigned", (x, y) => Object.assign({ x: 1, y: 2, name: "a" } as Point, { x, y })],
  ["listed", (x, y) => Object.fromEntries([["x", x], ["y", y], ["name", "f"]])],
  ["computed", (x, y) => ({ ["x"]: x, ["y"]: y, name: "k" }) as Point],
  ["maybe", (x, y) => (x === undefined ? { y, name: "m" } : { x, y, name: "m" }) as Maybe],
];
const then: [string, (p: any, v: any) => any][] = [
  ["as made", p => p],
  ["stored", (p, v) => ((p.x = v), p)],
  ["by key", (p, v) => ((p["y"] = v), p)],
  ["reflected", (p, v) => (Reflect.set(p, "x", v), p)],
  ["deleted", p => (delete p.y, p)],
  ["deleted, stored", (p, v) => (delete p.x, (p.x = v), p)],
  ["frozen", p => Object.freeze(p)],
  ["fixed", (p, v) => Object.defineProperty(p, "x", { value: v, writable: false })],
  ["getter", (p, v) => Object.defineProperty(p, "y", { get: () => v, configurable: true })],
  ["grown", (p, v) => ((p.more = v), p)],
  ["spread", p => ({ ...p })],
  ["without", p => (({ x, ...rest }) => rest)(p)],
  ["below", p => Object.create(p)],
];
const values: any[] = [1.5, -0, NaN, 7, 2 ** 40, "3", "", undefined, null, true, 5n, [2], { valueOf: () => 2.5 }];
const shown = (v: any): string =>
  typeof v === "object" && v !== null ? "o" : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "s" : Object.is(v, -0) ? "-0" : typeof v + String(v);
const all = (p: any): string => {
  const inLoop: string[] = [];
  for (const key in p) inLoop.push(key);
  return `${Object.keys(p)} ${inLoop} ${Object.values(p).map(shown)} ${Object.entries(p).length} ${"x" in p} ${Object.hasOwn(p, "y")} ${shown(Object.getOwnPropertyDescriptor(p, "x")?.value)}`;
};
for (const [how, make] of made)
  for (const [what, change] of then)
    for (let k = 0; k < values.length; k++) {
      let said: string;
      let p: any;
      try {
        p = change(make(values[k], values[(k * 5 + 2) % values.length]), values[(k + 4) % values.length]);
        said = all(p) + " " + shown(how === "maybe" ? half(p) : step(p, 0.5)) + " " + all(p);
      } catch (e: any) {
        said = e.constructor.name + " " + e.message + " " + (p ? all(p) : "");
      }
      lines.push(`${how}, ${what}, ${k}: ${said}`);
    }
for (const value of values) {
  try {
    const clone = structuredClone({ x: typeof value === "object" && value ? 9 : value, y: 1, name: "s" } as Point);
    lines.push(all(clone) + shown(step(clone, 2)) + all(clone));
  } catch (e: any) {
    lines.push(e.constructor.name + e.message);
  }
  try {
    const point: Point = { x: value, y: value, name: "j" };
    lines.push(JSON.stringify(point) + shown(step(JSON.parse(JSON.stringify(point)), 1)));
  } catch (e: any) {
    lines.push(e.constructor.name + e.message);
  }
  let list: Node2 | null = null;
  for (let i = 0; i < 5; i++) list = { weight: i === 2 ? value : i + 0.5, next: list };
  try {
    lines.push("list " + shown(sum(list)));
  } catch (e: any) {
    lines.push(e.constructor.name + e.message);
  }
}
console.log(lines.length);
let total = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) total = (Math.imul(total, 31) + line.charCodeAt(i)) | 0;
console.log(total);
for (let i = 0; i < lines.length; i += 29) console.log(lines[i]);
