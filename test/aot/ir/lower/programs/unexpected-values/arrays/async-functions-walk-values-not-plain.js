// RUN: lower
// OPTIONS: builtin-modules

// Async functions walk values that are not plain arrays.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

class Loud extends Array {
  map() {
    return ["the subclass's map"];
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const log = [];

const makers = {
  "an array": () => [3, 1, 2],
  "an array of promises": () => [Promise.resolve(3), 1, Promise.resolve(2)],
  "an array with a thenable": () => [3, { then(resolve) { log.push("then"); resolve("from then"); } }, 2],
  "an array with a hole": () => [3, , 2],
  "a subclass": () => Loud.of(3, 1, 2),
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "a string": () => "312",
  "a Set": () => new Set([3, 1, 2]),
  "a Map": () => new Map([[3, "c"]]),
  "a typed array": () => new Uint8Array([3, 1, 2]),
  "a generator": () => (function* () { yield 3; yield 1; yield 2; })(),
  "an async generator": () => (async function* () { yield 3; yield 1; yield 2; })(),
  "an object with both iterators": () => ({ *[Symbol.iterator]() { yield "sync"; }, async *[Symbol.asyncIterator]() { yield "async"; } }),
  "an array with its own async iterator": () => Object.assign([3, 1, 2], { async *[Symbol.asyncIterator]() { yield "its own async iterator"; } }),
  "a promise of an array": () => Promise.resolve([3, 1, 2]),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "arguments": () => (function () { return arguments; })(3, 1, 2),
  "null": () => null,
  "a number": () => 312,
};

const uses = {
  async sum(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += await list[i];
    return total;
  },
  async walk(list) {
    const seen = [];
    for (const value of list) seen.push(await value);
    return seen;
  },
  async walkAsynchronously(list) {
    const seen = [];
    for await (const value of list) seen.push(value);
    return seen;
  },
  async all(list) {
    return await Promise.all(list);
  },
  async allOfAMap(list) {
    return await Promise.all(list.map(async value => (await value) * 2));
  },
  async settled(list) {
    return (await Promise.allSettled(list)).length;
  },
  async race(list) {
    return await Promise.race(list);
  },
  async awaited(list) {
    const value = await list;
    return [Array.isArray(value), value.length];
  },
  async fromAsync(list) {
    return await Array.fromAsync(list);
  },
  async pattern(list) {
    const [first, second] = await list;
    return [await first, await second];
  },
  async *yielded(list) {
    yield* list;
  },
};

async function run(use, list) {
  const result = uses[use](list);
  if (use !== "yielded") return await result;
  const seen = [];
  for await (const value of result) seen.push(value);
  return seen;
}

for (const use in uses) for (let i = 0; i < 200; i++) await run(use, [3, 1, 2]);

for (const name in makers) {
  for (const use in uses) {
    log.length = 0;
    let answer;
    try {
      answer = describe(await run(use, makers[name]()));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(name + ", " + use + ": " + answer + (log.length ? " after " + log.join(" ") : ""));
  }
}

// GENERATED: attempt Loud walkAsynchronously fromAsync yielded
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="attempt"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Loud"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="walkAsynchronously"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v5 = IteratorOpen v1 iteratorKind=Async
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v5, -, v1 iteratorKind=Async
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v11 = PropGet v4 key="push"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v4, v9 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v5:
// CHECK-NEXT: v14 = CatchException
// CHECK-NEXT: IteratorClose v5, v1 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fromAsync"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array|AsyncGenerator flags=[IsExpected]}] results=[{type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|Array|AsyncGenerator):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Array
// CHECK-NEXT: v3 = Builtin builtin=ArrayFromAsync
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeName="Array.fromAsync"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected]}
// CHECK-NEXT: v6 = Await v5, v1
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="yielded"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|AsyncGenerator flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = IteratorOpen v2 iteratorKind=Async [isDelegating]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b2(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = IteratorResume v4, v6, v2 iteratorKind=Async [readsValueWhenDone]
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b5(v9), notTaken b3(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Yield v10, v2
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b4(v13), case b6(v13), otherwise b2(v13)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = IteratorResume v4, v15, v2 iteratorKind=Async resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Branch v17 -> taken b5(v18), notTaken b3(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = IteratorResume v4, v21, v2 iteratorKind=Async resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v23 = ResultAt v22
// CHECK-NEXT: v24 = ResultAt v22 index=1
// CHECK-NEXT: Branch v23 -> taken b7(v24), notTaken b3(v24)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
