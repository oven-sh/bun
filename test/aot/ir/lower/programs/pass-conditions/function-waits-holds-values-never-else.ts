// RUN: lower
// OPTIONS: builtin-modules

// A function that waits holds values that nothing else holds.
declare const Bun: { gc(isFull: boolean): void };
declare const Buffer: { from(text: string): Uint8Array };
declare function setImmediate(run: () => void): void;
const trail: string[] = [];
let meanwhile: () => void = () => {};
function show(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.length > 40 ? JSON.stringify(value.slice(0, 20)) + ".." + value.length + ".." + JSON.stringify(value.slice(-8)) : JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "symbol") return "symbol " + value.description;
  if (typeof value === "function") return "function answering " + show(value(), depth + 1);
  if (depth > 4) return "..";
  if (Array.isArray(value)) {
    let text = "[";
    for (let at = 0; at < value.length; at++) text += (at ? "," : "") + (at in value ? show(value[at], depth + 1) : "hole");
    const match = value as unknown as { index?: number; groups?: unknown };
    return text + "]" + (match.index === undefined ? "" : "@" + match.index + show(match.groups, depth + 1));
  }
  if (value instanceof Map) return "map" + show([...value], depth + 1);
  if (value instanceof Set) return "set" + show([...value], depth + 1);
  if (value instanceof Date) return "date " + value.getTime();
  if (value instanceof RegExp) return "pattern " + value.source + " " + value.flags + " " + value.lastIndex;
  if (value instanceof Error) return value.name + ": " + value.message + (value.cause === undefined ? "" : " because " + show(value.cause, depth + 1));
  if (ArrayBuffer.isView(value)) return value.constructor.name + " " + value.byteOffset + " " + Array.prototype.join.call(value, ",");
  if (value instanceof Promise) return "promise";
  if (value instanceof String) return "wrapped " + value;
  const object = value as Record<string, unknown> & { next?: () => unknown; toJSON?: () => unknown };
  if (typeof object.toJSON === "function") return "json " + show(object.toJSON(), depth + 1);
  if (typeof object.next === "function") return "iterator at " + show(object.next(), depth + 1);
  let text = "{";
  for (const name of Object.keys(object)) text += (text.length > 1 ? "," : "") + name + ":" + show(object[name], depth + 1);
  return text + "}";
}
function churn(count: number) {
  const kept: unknown[] = [];
  for (let at = 0; at < count; at++) kept.push({ a: -at, b: "churn" + at }, [-at, -at - 1, -at - 2], [at + 0.25], "churn".slice(at % 3) + at, { n: -at }, { inner: { n: -at }, list: [-at] });
  return kept.length;
}
function deep(levels: number, part: number, text: string): number {
  const here = { levels, part, text };
  return levels === 0 ? 0 : 1 + deep(levels - 1, part * 1.01, text) + (here.levels - levels);
}
function afterAJob(answer: number, isRejected = false) {
  return new Promise<number>((resolve, reject) =>
    queueMicrotask(() => {
      meanwhile();
      (isRejected ? reject : resolve)(answer);
    }),
  );
}
function afterATimer(answer: number) {
  return new Promise<number>(resolve =>
    setTimeout(() => {
      meanwhile();
      resolve(answer);
    }, 0),
  );
}
function afterAnImmediate(answer: number) {
  return new Promise<number>(resolve =>
    setImmediate(() => {
      meanwhile();
      resolve(answer);
    }),
  );
}
function thenable(answer: number): PromiseLike<number> {
  return {
    then(resolve: any) {
      meanwhile();
      return resolve(answer);
    },
  };
}
function* passing(answer: number): Generator<number, number, number> {
  const kept = { answer };
  const sent = yield kept.answer;
  return sent + kept.answer - answer;
}
function three(first: unknown, second: number, third: unknown) {
  return show(first) + second + show(third);
}
class Three {
  constructor(
    public first: unknown,
    public second: number,
    public third: unknown,
  ) {}
}
function boxed(held: unknown) {
  return {
    held,
    with(answer: number) {
      return show(this.held) + answer;
    },
  };
}
function startedOnly(promise: Promise<string>) {
  promise.then(text => trail.push("inner " + text));
  return "started";
}
function drive(made: Generator<number, string, number>) {
  let step = made.next();
  while (!step.done) {
    meanwhile();
    step = made.next(step.value);
  }
  return step.value;
}
async function driveAsync(made: AsyncGenerator<number, string, number>) {
  let step = await made.next();
  while (!step.done) {
    meanwhile();
    step = await made.next(step.value);
  }
  return step.value;
}
function mixed(text: string, into: number) {
  for (let at = 0; at < text.length; at++) into = (Math.imul(into, 31) + text.charCodeAt(at)) | 0;
  return into;
}

// 1: template--here--taken-out-of-an-array--async-generator--a-yield--a-collection-and-new-objects--once
function born1(seed: number) {
  return `<${seed}|${seed / 4}|${"x".padStart(seed % 6, "-")}>`;
}
const again1 = born1;
type Held1 = ReturnType<typeof born1>;
async function* waits1(seed: number): AsyncGenerator<number, string, number> {
  const [first, , ...others] = [(`<${seed}|${seed / 4}|${"x".padStart(seed % 6, "-")}>`), 0, again1(seed + 1), seed];
  const answer = (yield 1);
  return show(first) + answer + show(others);
}
async function case1() {
  meanwhile = () => {
    Bun.gc(true);
    churn(40);
    Bun.gc(true);
  };
  console.log("1", await driveAsync(waits1(4)));
}
// 2: large-integer--here--read-by-a-closure--async-method--a-thenable--new-objects--again-and-again
function born2(seed: number) {
  return seed * 4294967311;
}
const again2 = born2;
type Held2 = ReturnType<typeof born2>;
const owner2 = {
  async waits(seed: number): Promise<string> {
    const held = (seed * 4294967311);
    const read = () => held;
    const answer = (await thenable(1));
    return show(read()) + answer;
  },
};
const waits2 = (...all: Parameters<typeof owner2.waits>) => owner2.waits(...all);
async function case2() {
  meanwhile = () => {
    churn(150);
  };
  let sum = 0;
  let last = "";
  for (let seed = 1; seed <= 12; seed++) sum = mixed((last = await waits2(seed)), sum);
  console.log("2", sum, last);
}
// 3: small-bigint--here--stored-by-a-closure--generator-method--a-yield-of-another-generator--a-deep-recursion--many-at-once
function born3(seed: number) {
  return BigInt(seed);
}
const again3 = born3;
type Held3 = ReturnType<typeof born3>;
const owner3 = {
  *waits(seed: number): Generator<number, string, number> {
    let held: Held3 = (BigInt(seed));
    const store = (next: Held3) => {
      held = next;
    };
    const first = (yield* passing(1));
    const before = show(held);
    store(again3(seed + 1));
    const second = (yield* passing(2));
    return before + first + show(held) + second;
  },
};
const waits3 = (...all: Parameters<typeof owner3.waits>) => owner3.waits(...all);
async function case3() {
  meanwhile = () => {
    deep(400, 1.5, "d");
    Bun.gc(true);
  };
  const all: Promise<string>[] = [];
  for (let seed = 1; seed <= 8; seed++) all.push(Promise.resolve().then(() => drive(waits3(seed))));
  let sum = 0;
  const texts = await Promise.all(all);
  for (const text of texts) sum = mixed(text, sum);
  console.log("3", sum, texts[texts.length - 1]);
}
// 4: bound-function--here--closures-of-a-loop--async-arrow--a-plain-value--two-collections--once
function born4(seed: number) {
  return function (this: { n: number }, more: number) { return this.n + more; }.bind({ n: seed }, 2);
}
const again4 = born4;
type Held4 = ReturnType<typeof born4>;
const waits4 = async (seed: number): Promise<string> => {
  const readers: (() => string)[] = [];
  for (let turn = 0; turn < 3; turn++) {
    const held = (function (this: { n: number }, more: number) { return this.n + more; }.bind({ n: seed }, 2));
    readers.push(() => show(held) + turn);
    if ((queueMicrotask(meanwhile), await turn) !== turn) return "wrong answer";
  }
  return readers.map(read => read()).join();
};
async function case4() {
  meanwhile = () => {
    Bun.gc(true);
    Bun.gc(true);
  };
  console.log("4", await waits4(7));
}
await case1();
await case2();
await case3();
await case4();
await new Promise(resolve => setTimeout(resolve, 5));
console.log(trail.sort().join("\n"));

// GENERATED: passing mixed afterAJob waits3 store
// CHECK-LABEL: function {{*}}name="passing"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = Convert v2 declared={type=number}
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="answer"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v10 = Yield v9, v2
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Convert v11 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v14 = PropGet v7 key="answer"
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = Sub v15, v2
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_7]]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b2(v1, v3)
// CHECK-NEXT: b2(v4: number, v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Less v5, v8
// CHECK-NEXT: Branch v9 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = Builtin builtin=Math
// CHECK-NEXT: v12 = Builtin builtin=MathImul
// CHECK-NEXT: v13 = Integer integer=31
// CHECK-NEXT: v14 = Call v12, v11, v4, v13 calleeName="Math.imul"
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_11]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = PropGet v0 key="charCodeAt"
// CHECK-NEXT: v17 = Call v16, v0, v10 calleeKey="charCodeAt" calleeName="text.charCodeAt"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_12]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = Add v15, v18
// CHECK-NEXT: v20 = Integer
// CHECK-NEXT: v21 = BitOr v19, v20
// CHECK-NEXT: v22 = Convert v21 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v23 = Increment v10
// CHECK-NEXT: v24 = Convert v23 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b2(v22, v24)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v26 = Convert v4 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="afterAJob"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="afterAJob"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="waits3"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array<number> flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="owner3"
// CHECK-NEXT: v3 = PropGet v2 key="waits"
// CHECK-NEXT: v4 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v4, v0
// CHECK-NEXT: v6 = CallList v3, v2, v4 calleeKey="waits" calleeName="owner3.waits"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="store"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=env [[L_15]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|bigint flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: env [[L_15]], v1: undefined|null|bigint):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_15]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="held"
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|bigint flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_15]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
