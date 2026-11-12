// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="attempt"

// FILE: main.ts
// A javascript caller reaches int32 parameters and fields.
import { ways, withNothing } from "./caller.js";
import { Cursor, lineOf, uses } from "./typed.ts";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses(i | 0).length + lineOf(new Cursor(i | 0));
console.log("2000 honest rounds", warm);

const values: unknown[] = [3, 1.5, -0, NaN, 2 ** 31, -(2 ** 31) - 1, 1e21, Infinity, "7", null, undefined, true, [5], {}];
for (const [label, run] of Object.entries(ways)) {
  for (const value of values) attempt(label + " " + show(value), () => run(value));
}
attempt("with nothing", () => withNothing());
attempt("a bigint", () => ways["out of a table"](5n));
attempt("honest again", () => [uses(2), lineOf(new Cursor(9))]);

// FILE: caller.js
import { Cursor, lineOf, table, uses } from "./typed.ts";

export const ways = {
  "out of a table": n => table.uses(n),
  "by call": n => uses.call(null, n),
  "by apply": n => uses.apply(null, [n]),
  "bound": n => uses.bind(null, n)(),
  "as a callback": n => [n].map(uses)[0],
  "under another name": n => {
    const run = uses;
    return run(n);
  },
  "out of a list": n => [uses][0](n),
  "by Reflect.apply": n => Reflect.apply(uses, undefined, [n]),
  "stored in a field": n => {
    const cursor = new Cursor(1);
    cursor.line = n;
    return [lineOf(cursor), cursor.lineOf(), cursor.sum(), cursor.plainSum(), JSON.stringify(cursor)];
  },
  "stored in a field by a computed name": n => {
    const cursor = new Cursor(1);
    cursor[["li", "ne"].join("")] = n;
    return [lineOf(cursor), cursor.lineOf(), cursor.sum(), cursor.plainSum()];
  },
  "constructed by Reflect.construct": n => {
    const cursor = Reflect.construct(Cursor, [n]);
    return [lineOf(cursor), cursor.sum(), cursor.plainSum()];
  },
  "a look-alike is handed over": n => lineOf({ line: n, column: 0 }),
};

export function withNothing() {
  const run = uses;
  return run();
}

// FILE: typed.ts
import type { int32 } from "bun";

export class Cursor {
  line: int32 = 0;
  column: int32 = 4;
  constructor(line: int32) {
    this.line = line;
  }
  lineOf(): int32 {
    return this.line;
  }
  sum(): int32 {
    return (this.line + this.column) | 0;
  }
  plainSum(): number {
    return this.line + this.column;
  }
}

export function uses(v: int32): unknown[] {
  const cursor = new Cursor(v);
  const pair: int32[] = [v, 1];
  return [typeof v, v, v + 1, v * 2, v / 2, v % 2, -v, 1 / v, v | 0, v >>> 0, v >> 1, ~v, v === v, v === 0, v < 1, !v, String(v), cursor.line, cursor.column, pair[0], cursor.plainSum(), Math.floor(v), [10, 20, 30][v]];
}

export function lineOf(cursor: Cursor): int32 {
  return cursor.line;
}

export const table = { uses };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }
