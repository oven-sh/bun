// RUN: lower
// OPTIONS: builtin-modules

// Awaiting untyped values and lists of them.
interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

async function attempt(label: string, run: () => unknown): Promise<void> {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(await run());
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

const things = new Map<string, unknown>([
  ["a number", 3],
  ["a text", "3"],
  ["null", null],
  ["a point", { x: 1, y: 2 }],
  ["a promise of a number", Promise.resolve(3)],
  ["a promise of a text", Promise.resolve("3")],
  ["a promise of a promise", Promise.resolve(Promise.resolve("deep"))],
  [
    "a thenable",
    {
      then(resolve: (value: unknown) => void) {
        log.push("then");
        resolve("from then");
      },
    },
  ],
  [
    "a thenable that answers twice",
    {
      then(resolve: (value: unknown) => void) {
        resolve(1);
        resolve("second");
      },
    },
  ],
  [
    "a thenable with a getter",
    {
      get then() {
        log.push("get then");
        return undefined;
      },
      x: 1,
      y: 2,
    },
  ],
  ["then is a number", { then: 5, x: 1, y: 2 }],
  [
    "a thenable that rejects",
    {
      then(resolve: unknown, reject: (reason: unknown) => void) {
        reject("rejected");
      },
    },
  ],
]);
const lookUp: Function = (name: string) => things.get(name);

let warm = 0;
for (let i = 0; i < 500; i++) {
  const n: number = await lookUp("a number");
  const [m]: number[] = await Promise.all([lookUp("a number")]);
  warm += plusOne(n) + plusOne(m);
}
console.log("500 honest rounds: " + warm);

for (const name of things.keys()) {
  await attempt("awaited as a number, " + name, async () => {
    const n: number = await lookUp(name);
    return [typeof n, n + 1, plusOne(n)];
  });
  await attempt("awaited as a point, " + name, async () => {
    const p: Point = await lookUp(name);
    return [p.x, sum(p)];
  });
  await attempt("Promise.all, " + name, async () => {
    const list = lookUp(name) === null ? [null] : [lookUp(name), 1];
    const [n, m]: number[] = await Promise.all(list);
    return [typeof n, n + 1, m + 1];
  });
  await attempt("Promise.resolve and then, " + name, () => Promise.resolve(lookUp(name)).then((n: number) => plusOne(n)));
  await attempt("Promise.race, " + name, async () => {
    const n: number = await Promise.race([lookUp(name)]);
    return plusOne(n);
  });
  await attempt("returned by an async function, " + name, async () => {
    const f = async (): Promise<number> => lookUp(name);
    return plusOne(await f());
  });
  await attempt("for await, " + name, async () => {
    const seen: number[] = [];
    for await (const n of [lookUp(name)]) seen.push(plusOne(n));
    return seen;
  });
}

await attempt("Promise.all of a parsed list", async () => {
  const [a, b, c]: number[] = await Promise.all(JSON.parse('[1,"2",null]'));
  return [a + 1, b + 1, c + 1];
});
await attempt("Promise.all of a parsed text", async () => {
  const numbers: number[] = await Promise.all(JSON.parse('"12"'));
  return numbers.map(plusOne);
});
await attempt("Promise.all of a parsed number", async () => {
  const numbers: number[] = await Promise.all(JSON.parse("12"));
  return numbers.map(plusOne);
});
await attempt("Promise.all of nothing", async () => {
  const none: Point[] = await Promise.all([]);
  return [none.length, none[0]];
});

export {};

// GENERATED: attempt f
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|[[f_1]]):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: PropSet v4, v5 key="length"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v9 = String string=" -> "
// CHECK-NEXT: v10 = Add v1, v9
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = Call v2 calleeName="run"
// CHECK-NEXT: v13 = Await v12, v1, v2
// CHECK-NEXT: v14 = Call v11, -, v13 calleeName="show"
// CHECK-NEXT: v15 = Add v10, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v17 = CatchValue
// CHECK-NEXT: v18 = String string=" threw "
// CHECK-NEXT: v19 = Add v1, v18
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="Error" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v23 = InstanceOf v17, v22
// CHECK-NEXT: v24 = ToBoolean v23
// CHECK-NEXT: Branch v24 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v25):
// CHECK-NEXT: v26 = PropGet v17 key="constructor"
// CHECK-NEXT: v27 = PropGet v26 key="name"
// CHECK-NEXT: Jump -> next b5(v27)
// CHECK-NEXT: b4(v28):
// CHECK-NEXT: v29 = TypeOf v17
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b5(v30):
// CHECK-NEXT: v31 = Add v19, v30
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v32)
// CHECK-NEXT: b6(v33: undefined|null|string):
// CHECK-NEXT: v34 = Builtin builtin=GlobalThis
// CHECK-NEXT: v35 = PropGet v34 key="console" [isFreeName]
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="log"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v40 = CheckInitialized v39 name="log"
// CHECK-NEXT: v41 = PropGet v40 key="length"
// CHECK-NEXT: v42 = Integer
// CHECK-NEXT: v43 = Greater v41, v42
// CHECK-NEXT: Branch v43 -> taken b7(), notTaken b8(v33)
// CHECK-NEXT: b7():
// CHECK-NEXT: v44 = String string=" | "
// CHECK-NEXT: v45 = Add v33, v44
// CHECK-NEXT: v46 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v47 = CheckInitialized v46 name="log"
// CHECK-NEXT: v48 = PropGet v47 key="join"
// CHECK-NEXT: v49 = String string=" "
// CHECK-NEXT: v50 = Call v48, v47, v49 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v52 = Add v45, v51
// CHECK-NEXT: Jump -> next b8(v52)
// CHECK-NEXT: b8(v53):
// CHECK-NEXT: v54 = Call v38, v36, v53 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v55 = Undefined
// CHECK-NEXT: Return v55
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] captures=[{type=anything variableName="name"}] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="lookUp"
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="lookUp"
// CHECK-NEXT: v4 = Convert v3 declared={type=number|object}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
