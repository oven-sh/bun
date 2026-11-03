// Caught values are untyped and fill typed places.
interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

class Holder {
  p: Point = { x: 0, y: 0 };
  n = 0;
  take(thrown: unknown): this {
    try {
      throw thrown;
    } catch (e) {
      this.p = e;
      this.n = e;
    }
    return this;
  }
}

const uses: [string, (thrown: unknown) => unknown][] = [
  [
    "a local point",
    thrown => {
      try {
        throw thrown;
      } catch (e) {
        const p: Point = e;
        return [p.x, p.y, p.x + p.y];
      }
    },
  ],
  [
    "a parameter",
    thrown => {
      try {
        throw thrown;
      } catch (e) {
        return sum(e);
      }
    },
  ],
  [
    "fields",
    thrown => {
      const holder = new Holder().take(thrown);
      return [holder.p.x, holder.n + 1, typeof holder.n];
    },
  ],
  [
    "an element and a map value",
    thrown => {
      const list: Point[] = [{ x: 1, y: 2 }];
      const map = new Map<string, Point>();
      try {
        throw thrown;
      } catch (e) {
        list.push(e);
        map.set("k", e);
      }
      return [list.map(sum), map.get("k")?.y];
    },
  ],
  [
    "a pattern",
    thrown => {
      try {
        throw thrown;
      } catch ({ x, y }) {
        const a: number = x;
        const b: number = y;
        return [a + b, plusOne(a)];
      }
    },
  ],
  [
    "a number",
    thrown => {
      try {
        throw thrown;
      } catch (e) {
        const n: number = e;
        return [n + 1, plusOne(e), [10, 20, 30, 40][n], typeof n];
      }
    },
  ],
  [
    "a function",
    thrown => {
      try {
        throw thrown;
      } catch (e) {
        const f: (n: number) => number = e;
        return f(1) + 1;
      }
    },
  ],
  [
    "members of an error",
    thrown => {
      try {
        throw thrown;
      } catch (e) {
        const message: string = e.message;
        const code: number = e.code;
        return [message + "!", code + 1, typeof e.stack];
      }
    },
  ],
  [
    "thrown again from finally",
    thrown => {
      let n = 0;
      try {
        try {
          throw thrown;
        } finally {
          n = 1;
        }
      } catch (e) {
        n += e;
      }
      return [n, typeof n];
    },
  ],
];

const thrown: [string, unknown][] = [
  ["a point", { x: 1, y: 2 }],
  ["texts", { x: "1", y: "2" }],
  ["an error", new Error("e")],
  ["an error with a code", Object.assign(new RangeError("r"), { code: "7", x: 1, y: 2 })],
  [
    "getters",
    {
      get x() {
        log.push("x");
        return 1;
      },
      get y() {
        log.push("y");
        return 2;
      },
    },
  ],
  ["a number", 3],
  ["a text", "3"],
  ["a bigint", 3n],
  ["a list", [1, 2]],
  ["a function", (n: number) => n + "!"],
  ["null", null],
  ["undefined", undefined],
];

for (const [use, run] of uses) {
  let rounds = 0;
  const honest = use === "a number" || use === "thrown again from finally" ? 3 : use === "a function" ? (n: number) => n + 1 : use === "members of an error" ? Object.assign(new Error("e"), { code: 1 }) : { x: 1, y: 2 };
  for (let i = 0; i < 2000; i++) {
    run(honest);
    rounds++;
  }
  console.log(use + ": " + rounds + " honest rounds");
  for (const [name, value] of thrown) attempt(use + ", " + name, () => run(value));
}
