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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_5]]}
// CHECK-NEXT: PropSet v4, v6 key="length"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v10 = String string=" -> "
// CHECK-NEXT: v11 = Add v1, v10
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v13 = Call v2 calleeName="run"
// CHECK-NEXT: v14 = Await v13, v1, v2
// CHECK-NEXT: v15 = Call v12, -, v14 calleeName="show"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = Add v11, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b11(v18)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v19 = CatchValue
// CHECK-NEXT: v20 = String string=" threw "
// CHECK-NEXT: v21 = Add v1, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v19, v24 writtenExpression="error instanceof Error"
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v27):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v28 = Convert v19 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="constructor"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|function site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v31 = PropGet v30 key="name"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v32)
// CHECK-NEXT: b8(v33):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v34 = TypeOf v19
// CHECK-NEXT: Jump -> next b10(v34)
// CHECK-NEXT: b10(v35):
// CHECK-NEXT: v36 = Add v21, v35
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b11(v37)
// CHECK-NEXT: b11(v38: undefined|null|string):
// CHECK-NEXT: v39 = Builtin builtin=GlobalThis
// CHECK-NEXT: v40 = PropGet v39 key="console" [isFreeName]
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v42 = PropGet v41 key="log"
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v44 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v45 = CheckInitialized v44 name="log"
// CHECK-NEXT: v46 = PropGet v45 key="length"
// CHECK-NEXT: v47 = Convert v46 declared={type=number site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v48 = Integer
// CHECK-NEXT: v49 = Greater v47, v48
// CHECK-NEXT: Branch v49 -> taken b12(), notTaken b13()
// CHECK-NEXT: b12():
// CHECK-NEXT: v50 = String string=" | "
// CHECK-NEXT: v51 = Add v38, v50
// CHECK-NEXT: v52 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v53 = CheckInitialized v52 name="log"
// CHECK-NEXT: v54 = PropGet v53 key="join"
// CHECK-NEXT: v55 = String string=" "
// CHECK-NEXT: v56 = Call v54, v53, v55 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v57 = Convert v56 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v58 = Add v51, v57
// CHECK-NEXT: Jump -> next b14(v58)
// CHECK-NEXT: b13():
// CHECK-NEXT: Jump -> next b14(v38)
// CHECK-NEXT: b14(v59):
// CHECK-NEXT: v60 = Call v43, v41, v59 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v61 = Undefined
// CHECK-NEXT: Return v61
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] captures=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="lookUp"
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="lookUp"
// CHECK-NEXT: v4 = Convert v3 declared={type=number|object site=[[w_15]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
