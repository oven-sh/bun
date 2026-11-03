// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1

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

// GENERATED: attempt
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v9 = Call v1 calleeName="run"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="show"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = Call v6, v4, v0, v7, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="threw"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="Error" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v23 = InstanceOf v13, v22 writtenExpression="error instanceof Error"
// CHECK-NEXT: v24 = ToBoolean v23
// CHECK-NEXT: Branch v24 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v25):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v26 = Convert v13 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="constructor"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|function site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v30)
// CHECK-NEXT: b7(v31):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v32 = TypeOf v13
// CHECK-NEXT: Jump -> next b9(v32)
// CHECK-NEXT: b9(v33):
// CHECK-NEXT: v34 = Call v18, v16, v0, v19, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
