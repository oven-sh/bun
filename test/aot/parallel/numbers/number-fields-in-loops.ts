// Fields written `number` of objects that loops, variables and closures lead to: one object of each list holds another value.
const lines: string[] = [];
const trace: string[] = [];
interface Point {
  x: number;
  y: number;
}
class Body {
  x: number;
  y: number;
  vx: number;
  constructor(o: any) {
    this.x = o.x;
    this.y = o.y;
    this.vx = o.vx;
  }
}
interface World {
  body: Body;
  origin: Point;
}
const results: any[] = [];
function overValues(list: Body[], dt: number): void {
  for (const b of list) {
    b.x += b.vx * dt;
    if (b.x > 5 || b.y < b.x) b.vx = -b.vx;
    results.push(b.x - b.y);
  }
}
function overPositions(list: Body[], dt: number): void {
  for (let i = 0; i < list.length; i++) {
    list[i]!.x -= list[i]!.y * dt;
    results.push(list[i]!.x | 0);
  }
}
function throughCallback(list: Body[], dt: number): void {
  list.forEach(b => {
    b.y = b.x * b.x + dt;
    results.push(b.y);
  });
}
function move(w: World, dt: number): number {
  w.body.x += w.body.vx * dt;
  w.origin.x = w.body.x - w.origin.y;
  return w.origin.x * 2;
}
function throughFields(list: Body[], dt: number): void {
  const w: World = { body: list[0]!, origin: { x: 1, y: 0.5 } };
  for (const b of list) {
    w.body = b;
    results.push(move(w, dt));
  }
}
let held: Body;
let amount: number;
function moveHeld(): number {
  held.x += held.vx * amount;
  held.y -= amount;
  return held.x > held.y ? held.x : held.y;
}
function throughVariables(list: Body[], dt: number): void {
  amount = dt;
  for (const b of list) {
    held = b;
    results.push(moveHeld());
  }
}
function sums(list: Point[]): void {
  let s = 0;
  for (const p of list) s += p.x * p.x + p.y * p.y;
  results.push(s);
}
const values: any[] = [
  1.5,
  -0,
  7,
  2 ** 33,
  "3",
  undefined,
  null,
  true,
  6n,
  {
    valueOf() {
      trace.push("v");
      return 2.5;
    },
  },
  {
    valueOf() {
      trace.push("w");
      throw new RangeError("w");
    },
  },
];
const amounts: any[] = [0.5, 2, "4", undefined];
const shown = (v: any): string =>
  typeof v === "object" && v !== null ? "o" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v + v;
const uses: [string, (list: any[], dt: any) => void][] = [
  ["values", overValues],
  ["positions", overPositions],
  ["callback", throughCallback],
  ["fields", throughFields],
  ["variables", throughVariables],
  ["sums", sums],
];
const born = (kind: string, o: any): any => (kind === "class" ? new Body(o) : kind === "literal" ? { x: o.x, y: o.y, vx: o.vx } : Object.assign(JSON.parse('{"x":0.25,"y":1,"vx":2}'), o));
for (const kind of ["class", "literal", "parsed"])
  for (const [name, use] of uses)
    for (const key of ["x", "y", "vx"])
      for (let k = 0; k < values.length; k++)
        for (const dt of amounts) {
          trace.length = results.length = 0;
          const list: any[] = [];
          for (let i = 0; i < 4; i++) list.push(born(kind, { x: i + 0.5, y: 3 - i, vx: i - 1.25 }));
          if (k & 1) list[k % 4][key] = values[k];
          else list[k % 4] = born(kind, { x: 1, y: 2, vx: 3, [key]: values[k] });
          let said = "";
          try {
            use(list, dt);
          } catch (e: any) {
            said = e.constructor.name + " " + e.message;
          }
          lines.push(`${kind} ${name} ${key}: ${said} ${results.map(shown).join(" ")} | ${list.map(b => [b.x, b.y, b.vx].map(shown).join(",")).join(" ")} ${trace.join("")}`);
        }
console.log(lines.length);
let sum = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) sum = (Math.imul(sum, 31) + line.charCodeAt(i)) | 0;
console.log(sum);
for (let i = 0; i < lines.length; i += 43) console.log(lines[i]);
