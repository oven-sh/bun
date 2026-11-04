// RUN: lower
// OPTIONS: builtin-modules

// The then of an awaited object is a getter.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

let log: string[] = [];

class Lazy implements PromiseLike<number> {
  reads = 0;
  get then(): PromiseLike<number>["then"] {
    const read = ++this.reads;
    log.push("get then " + read);
    return <A = number, B = never>(onfulfilled?: Fulfilled<number, A>, _?: Rejected<B>): PromiseLike<A | B> => {
      log.push("call then " + read);
      onfulfilled?.(read * 100);
      return new Promise<A | B>(() => {});
    };
  }
}

class Inherited extends Lazy {}

const onThePrototype: PromiseLike<number> = Object.create(new Lazy());

async function once(thenable: PromiseLike<number>): Promise<number> {
  return (await thenable) + 1;
}

async function twice(thenable: PromiseLike<number>): Promise<number> {
  const a: number = await thenable;
  const b: number = await thenable;
  return a + b;
}

async function handedBack(thenable: PromiseLike<number>): Promise<number> {
  return thenable;
}

const uses: [string, (thenable: PromiseLike<number>) => Promise<unknown>][] = [
  ["await once", once],
  ["await twice", twice],
  ["returned from an async function", handedBack],
  ["Promise.resolve", thenable => Promise.resolve(thenable)],
  ["a resolve function", thenable => new Promise<number>(resolve => resolve(thenable))],
  ["a reaction's result", thenable => Promise.resolve().then(() => thenable)],
  ["Promise.all of two", thenable => Promise.all([thenable, thenable])],
  ["Promise.race", thenable => Promise.race([thenable])],
  ["Promise.any", thenable => Promise.any([thenable])],
  ["Promise.allSettled", thenable => Promise.allSettled([thenable])],
  ["for await", async thenable => {
    const out: number[] = [];
    for await (const n of [thenable, thenable]) out.push(n);
    return out;
  }],
  ["yielded by an async generator", async thenable => {
    async function* source(): AsyncGenerator<number, void, void> {
      yield thenable;
    }
    const out: number[] = [];
    for await (const n of source()) out.push(n);
    return out;
  }],
];

for (const [label, use] of uses) {
  for (const [kind, make] of [
    ["own class", () => new Lazy()],
    ["subclass", () => new Inherited()],
  ] satisfies [string, () => PromiseLike<number>][]) {
    log = [];
    console.log(label + ", " + kind + ": " + text(await use(make())));
    console.log(label + ", " + kind + " log: " + log.join(", "));
  }
}

log = [];
console.log("two levels up the prototype chain: " + text(await once(onThePrototype)));
console.log("log: " + log.join(", "));

export {};

// GENERATED: once Lazy then Inherited source
// CHECK-LABEL: function {{*}}name="once"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|Promise<number>):
// CHECK-NEXT: v2 = Await v1, v1
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number|object}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Lazy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="then"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]]} results=[{type=undefined|null|[[f_4]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="reads"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: PropSet v0, v2 key="reads"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="log"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = String string="get then "
// CHECK-NEXT: v8 = Add v7, v2
// CHECK-NEXT: v9 = Call v6, v5, v8 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v10 = Convert v9 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = NewClosure v2 function=[[f_6]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Inherited"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="source"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] captures=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined] variableName="thenable"}] thisType={type=anything} results=[{type=undefined|null|AsyncGenerator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Promise<number>, v1: anything, v2: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = Await v0
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
