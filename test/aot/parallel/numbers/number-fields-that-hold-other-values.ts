// Fields written `number` that hold whatever unseen code stored: operators on them, outside of loops, behave as plain.
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
  compare(limit: number): string {
    if (this.x < 0) return "below";
    if (this.x > 100) return "above";
    return this.y >= limit ? "at" : "under";
  }
  step(dt: number): void {
    this.x += this.vx * dt;
    if (this.x < 0 || this.x > 100) this.vx = -this.vx;
    this.y += 9.8 * dt;
  }
  bits(): number {
    return (this.x | 0) + (this.y >>> 1);
  }
}
function swap(p: Point, by: number): number {
  p.x = p.y;
  p.y = p.x * by;
  return p.x - p.y;
}
const values: any[] = [
  1.5,
  -0,
  NaN,
  -7,
  250,
  2 ** 40,
  "7",
  "",
  undefined,
  null,
  true,
  10n,
  {},
  {
    valueOf() {
      trace.push("v");
      return 4;
    },
  },
  {
    valueOf() {
      throw new RangeError("w");
    },
  },
];
const amounts: any[] = [0.25, "3", undefined, 5n, { valueOf: () => 2 }];
const shown = (v: any): string =>
  typeof v === "object" && v !== null ? "o" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v + v;
const fills: [string, (v: any) => any][] = [
  ["constructor", v => new Body({ x: v, y: 2, vx: -3 })],
  [
    "store",
    v => {
      const b: any = new Body({ x: 1, y: 2.5, vx: -3 });
      b["y"] = v;
      return b;
    },
  ],
  ["assign", v => Object.assign(new Body({ x: 1, y: 2.5, vx: -3 }), { vx: v })],
  [
    "getter",
    v =>
      Object.defineProperty(new Body({ x: 1, y: 2.5, vx: -3 }), "x", {
        get() {
          trace.push("g");
          return v;
        },
        set() {
          trace.push("s");
        },
      }),
  ],
  ["frozen", v => Object.freeze(new Body({ x: v, y: v, vx: 1 }))],
  [
    "deleted",
    v => {
      const b: any = new Body({ x: 1, y: v, vx: -3 });
      delete b.x;
      return b;
    },
  ],
  ["parsed", v => Object.assign(new Body(JSON.parse('{"x":10.5,"y":20.25,"vx":3.5}')), { x: v })],
];
const uses: [string, (b: any, a: any) => any][] = [
  ["compare", (b, a) => b.compare(a)],
  ["step", (b, a) => b.step(a)],
  ["bits", b => b.bits()],
  ["swap", (b, a) => swap(b, a)],
];
for (const [how, fill] of fills)
  for (const [use, run] of uses)
    for (const value of values)
      for (const amount of amounts) {
        trace.length = 0;
        let said: string, after: string;
        let b: any;
        try {
          b = fill(value);
          said = shown(run(b, amount));
        } catch (e: any) {
          said = e.constructor.name + " " + e.message;
        }
        try {
          after = [b.x, b.y, b.vx].map(shown).join(",");
        } catch (e: any) {
          after = e.constructor.name;
        }
        lines.push(`${how} ${use} ${shown(value)} ${shown(amount)}: ${said} ${after} ${trace.join("")}`);
      }
console.log(lines.length, lines.filter(line => line.includes("Error")).length);
let sum = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) sum = (Math.imul(sum, 31) + line.charCodeAt(i)) | 0;
console.log(sum);
for (let i = 0; i < lines.length; i += 37) console.log(lines[i]);
