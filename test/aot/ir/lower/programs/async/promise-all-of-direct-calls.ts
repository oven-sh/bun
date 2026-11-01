// RUN: lower
// OPTIONS: builtin-modules

// `Promise.all([f(), g()])` over an array literal of calls of async functions: the order of jobs, which rejection wins, what each kind of element does, and that the result is an ordinary array.
const log: string[] = [];
const settled = Promise.resolve(0);
const collect: (sync?: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
function ticks(name: string, count: number): void {
  let chain: Promise<unknown> = settled;
  for (let i = 1; i <= count; i++) chain = chain.then(() => log.push(name + " tick " + i));
}
function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function atOnce(n: number): Promise<number> {
  log.push("atOnce " + n);
  return n;
}
async function later(n: number, turns: number): Promise<number> {
  log.push("later enters " + n);
  for (let i = 0; i < turns; i++) await settled;
  log.push("later ends " + n);
  return n;
}
async function object(n: number): Promise<{ n: number }> {
  if (n & 1) await settled;
  return { n };
}
async function failsAtOnce(n: number): Promise<number> {
  throw new Error("fails at once " + n);
}
async function failsLater(n: number, turns: number): Promise<number> {
  for (let i = 0; i < turns; i++) await settled;
  throw new Error("fails later " + n);
}
async function givesPromise(n: number): Promise<number> {
  return Promise.resolve(n);
}
async function givesThenable(n: number): Promise<number> {
  await settled;
  return { then(resolve: (value: number) => void) { log.push("the thenable is asked " + n); resolve(n); } } as PromiseLike<number>;
}
async function nested(n: number): Promise<number> {
  const [a, b] = await Promise.all([later(n, 1), atOnce(n + 1)]);
  return a + b;
}
function throwsPlainly(): number {
  throw new Error("thrown while the list is made");
}
const thenable: PromiseLike<string> = { then(resolve: any) { log.push("the plain thenable is asked"); resolve("from a thenable"); return undefined as any; } };

async function show(name: string, run: () => Promise<unknown>): Promise<void> {
  ticks(name, 9);
  try {
    log.push(name + " gives " + JSON.stringify(await run()));
  } catch (error) {
    log.push(name + " throws " + text(error));
  }
  for (let i = 0; i < 12; i++) await settled;
}

async function main(): Promise<void> {
  await show("both at once", async () => await Promise.all([atOnce(1), atOnce(2)]));
  await show("both later", async () => await Promise.all([later(1, 1), later(2, 3)]));
  await show("the first is slower", async () => await Promise.all([later(1, 4), later(2, 1), atOnce(3)]));
  await show("objects", async () => await Promise.all([object(1), object(2), object(3)]));
  await show("one element", async () => await Promise.all([later(1, 2)]));
  await show("no element", async () => await Promise.all([]));
  await show("values among calls", async () => await Promise.all([1, atOnce(2), "three", later(4, 1), null, undefined, { five: 5 }]));
  await show("promises among calls", async () => await Promise.all([settled, atOnce(2), Promise.resolve("three"), later(4, 2), new Promise(resolve => settled.then(() => resolve("five")))]));
  await show("a thenable among calls", async () => await Promise.all([later(1, 1), thenable, atOnce(3)]));
  await show("results that are promises", async () => await Promise.all([givesPromise(1), givesThenable(2), atOnce(3)]));
  await show("a conditional element", async () => await Promise.all([atOnce(1), log.length > 0 ? later(2, 1) : null, log.length < 0 ? later(3, 1) : null]));
  await show("an await in the list", async () => await Promise.all([later(1, 1), await later(2, 3), later(3, 1)]));
  await show("nested", async () => await Promise.all([nested(1), nested(10), Promise.all([atOnce(20), later(21, 2)])]));
  await show("fails at once", async () => await Promise.all([failsAtOnce(1), later(2, 2)]));
  await show("fails later", async () => await Promise.all([later(1, 3), failsLater(2, 1)]));
  await show("two fail, the second first", async () => await Promise.all([failsLater(1, 3), failsLater(2, 1), later(3, 5)]));
  await show("two fail at once", async () => await Promise.all([failsAtOnce(1), failsAtOnce(2)]));
  await show("the list is never made", async () => await Promise.all([later(1, 2), atOnce(2), throwsPlainly()]));
  await show("the pattern", async () => {
    const [a, { n }, c = "default"] = await Promise.all([later(1, 1), object(2), undefined]);
    return [a, n, c];
  });
  await show("the promise is kept", async () => {
    const all = Promise.all([later(1, 2), atOnce(2)]);
    log.push("kept is a promise " + (all instanceof Promise));
    all.then(values => log.push("then sees " + values.join()));
    const first = await all;
    const second = await all;
    return [first === second, Array.isArray(first), first.length];
  });
  await show("the result is an ordinary array", async () => {
    const values = await Promise.all([atOnce(1), later(2, 1)]);
    values.push(3);
    values[0] = 10;
    return [values, Object.getPrototypeOf(values) === Array.prototype, Object.keys(values)];
  });
  await show("not awaited", async () => {
    void Promise.all([later(1, 1), atOnce(2)]).then(values => log.push("unawaited gives " + values.join()));
    return "went on";
  });
  await show("returned", () => Promise.all([later(1, 1), atOnce(2)]));
  await show("in a plain function", async () => await ((): Promise<number[]> => Promise.all([later(1, 1), atOnce(2)]))());
  await show("with collections", async () => {
    const all = Promise.all([object(1), object(3), later(5, 4)]);
    collect(true);
    await settled;
    collect(true);
    const values = await all;
    collect(true);
    return values;
  });
  const many: Promise<number[]>[] = [];
  for (let i = 0; i < 100; i++) many.push(Promise.all([later(i, i % 4), atOnce(i), nested(i)]));
  const sums = (await Promise.all(many)).map(([a, b, c]) => a + b + c);
  log.push("many " + sums.reduce((a, b) => a + b, 0));
}

main().then(() => {
  let hash = 0;
  for (const line of log) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
  for (const line of log.slice(0, 420)) console.log(line);
  console.log(log.length + " lines, hash " + hash);
});

// GENERATED: text givesThenable nested
// CHECK-LABEL: function {{*}}name="text"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Error" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v4 = InstanceOf v0, v3 writtenExpression="error instanceof Error"
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b5(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="message"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_2]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Return v9
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = Builtin builtin=String
// CHECK-NEXT: v12 = Call v11, -, v0 calleeName="String"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="givesThenable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_4]]}] results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="settled"
// CHECK-NEXT: v4 = Await v3, v1
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_6]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v6 = NewClosure v1 function=[[f_7]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_8]]|[[f_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = NewObject -, v7 layout=[[L_10]] fields=[0]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = Convert v10 declared={type=number|object site=[[w_11]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_12]]}] results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="all"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(PromiseAll) flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Call v7, -, v1, v8 calleeName="later"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v1, v12
// CHECK-NEXT: v14 = Call v11, -, v13 calleeName="atOnce"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = NewArray v10, v15 contents=undefined|null|Promise<number>
// CHECK-NEXT: v17 = Call v6, v4, v16 calleeKey="all" calleeName="Promise.all"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Promise<undefined|null|Array<number>> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = Await v18, v1
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array<number> site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v21 = IteratorOpen v20 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b7():
// CHECK-NEXT: v22 = IteratorResume v21 stepIndex=0
// CHECK-NEXT: v23 = ResultAt v22
// CHECK-NEXT: v24 = ResultAt v22 index=1
// CHECK-NEXT: v25 = Convert v24 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b7():
// CHECK-NEXT: v26 = IteratorResume v21 stepIndex=1
// CHECK-NEXT: v27 = ResultAt v26
// CHECK-NEXT: v28 = ResultAt v26 index=1
// CHECK-NEXT: v29 = Convert v28 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b7():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: IteratorClose v21
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v31 = Add v25, v29
// CHECK-NEXT: v32 = Convert v31 declared={type=number|object site=[[w_16]]}
// CHECK-NEXT: Return v32
// CHECK-NEXT: b7() role=IterationCleanup subject=v21:
// CHECK-NEXT: v33 = CatchException
// CHECK-NEXT: IteratorClose v21 completion=Throw
// CHECK-NEXT: Rethrow v33
// CHECK-NEXT: }
