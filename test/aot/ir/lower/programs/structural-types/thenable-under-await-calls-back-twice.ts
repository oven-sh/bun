// RUN: lower
// OPTIONS: builtin-modules

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

type Fulfilled<T, A> = ((value: T) => A | PromiseLike<A>) | null;
type Rejected<B> = ((reason: unknown) => B | PromiseLike<B>) | null;

class Scripted implements PromiseLike<number> {
  label: string;
  script: (resolve: (value: number) => unknown, reject: (reason: unknown) => unknown) => void;
  constructor(label: string, script: (resolve: (value: number) => unknown, reject: (reason: unknown) => unknown) => void) {
    this.label = label;
    this.script = script;
  }
  then<A = number, B = never>(onfulfilled?: Fulfilled<number, A>, onrejected?: Rejected<B>): PromiseLike<A | B> {
    console.log(this.label + ": then gets " + typeof onfulfilled + " and " + typeof onrejected + ", " + arguments.length + " arguments");
    this.script(
      value => (onfulfilled ? onfulfilled(value) : "no function"),
      reason => (onrejected ? onrejected(reason) : "no function"),
    );
    return new Promise<A | B>(() => {});
  }
}

let continued = 0;

async function wait(thenable: PromiseLike<number>, label: string): Promise<string> {
  try {
    const n: number = await thenable;
    continued++;
    return label + " continued with " + text(n) + ", twice it is " + text(n * 2);
  } catch (error) {
    continued++;
    return label + " caught " + text(error);
  }
}

const scripts: [string, (resolve: (value: number) => unknown, reject: (reason: unknown) => unknown) => void][] = [
  ["once", resolve => {
    console.log("  the callback returns " + text(resolve(1)));
  }],
  ["twice", resolve => {
    resolve(1);
    console.log("  the second call returns " + text(resolve(2)));
  }],
  ["three times", resolve => {
    resolve(1);
    resolve(2);
    resolve(3);
  }],
  ["resolves and then rejects", (resolve, reject) => {
    resolve(1);
    reject("too late");
  }],
  ["rejects and then resolves", (resolve, reject) => {
    reject("first");
    resolve(2);
  }],
  ["rejects twice", (_, reject) => {
    reject("first");
    reject("second");
  }],
  ["once now and once in a later job", resolve => {
    resolve(1);
    queueMicrotask(() => {
      console.log("  the later call returns " + text(resolve(2)));
    });
  }],
  ["only in a later job, twice", resolve => {
    queueMicrotask(() => {
      resolve(10);
      resolve(20);
    });
  }],
];

for (const [label, script] of scripts) {
  continued = 0;
  console.log(await wait(new Scripted(label, script), label));
  await null;
  await null;
  console.log(label + ": the function went on " + continued + " time(s)");
}

console.log(await wait(Promise.resolve(5), "a real promise at the same place"));

export {};

// GENERATED: Scripted then
// CHECK-LABEL: function {{*}}name="Scripted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_5]]
// CHECK-NEXT: v7 = Convert v1 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v5, v7 key="label"
// CHECK-NEXT: v9 = Convert v2 declared={type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v5, v9 key="script"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="then"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] length=2 thisType={type=[[L_4]] site=[[w_9]]} parameters=[{type=undefined|null|[[f_10]] site=[[w_11]]}, {type=undefined|null|[[f_12]] site=[[w_13]]}] results=[{type=undefined|null|Promise<undefined|null|[[L_14]]|[[L_15]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_4]], v1: int[0, 4294967295], v2: undefined|null|[[f_10]], v3: undefined|null|[[f_12]], v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateUnmappedArguments v1, v4, v2, v3
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v0 key="label"
// CHECK-NEXT: v12 = String string=": then gets "
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = TypeOf v2
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = String string=" and "
// CHECK-NEXT: v17 = Add v15, v16
// CHECK-NEXT: v18 = TypeOf v3
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = String string=", "
// CHECK-NEXT: v21 = Add v19, v20
// CHECK-NEXT: v22 = PropGet v5 key="length"
// CHECK-NEXT: v23 = Add v21, v22
// CHECK-NEXT: v24 = String string=" arguments"
// CHECK-NEXT: v25 = Add v23, v24
// CHECK-NEXT: v26 = Call v10, v8, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = PropGet v0 key="script"
// CHECK-NEXT: v28 = NewClosure v2 function=[[f_16]]
// CHECK-NEXT: v29 = NewClosure v3 function=[[f_17]]
// CHECK-NEXT: v30 = Call v27, v0, v28, v29 calleeKey="script" calleeName="this.script"
// CHECK-NEXT: v31 = Builtin builtin=GlobalThis
// CHECK-NEXT: v32 = PropGet v31 key="Promise" [isFreeName]
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v34 = NewClosure function=[[f_18]]
// CHECK-NEXT: v35 = Construct v33, -, v34 calleeName="Promise"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|Promise<undefined|null|[[L_14]]|[[L_15]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
