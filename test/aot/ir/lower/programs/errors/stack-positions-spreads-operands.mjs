// RUN: lower
// OPTIONS: builtin-modules

// What stands behind `...` in a list or among arguments throws while it is walked. The program prints the frames of each error.
const lib = {
  *boom() {
    throw new Error("boom");
  },
  trap() {
    return {
      get value() {
        throw new Error("trap");
      },
    };
  },
  get list() {
    return lib.boom();
  },
};
const other = lib;
const flag = Date.now() > 0;
const make = async () => lib;
const take = (...values) => values.length;
class Taker {
  constructor(...values) {}
}
let kept;
const forms = [
  () => [...(0, lib.boom)()],
  async () => [...(await make()).boom()],
  () => [...(lib ?? other).boom()],
  () => [...(flag ? lib : other).boom()],
  () => [...lib.boom()],
  () => [1, ...(0, lib.boom)()],
  () => take(...(0, lib.boom)()),
  () => new Taker(...(0, lib.boom)()),
  () => ({ ...(0, lib.trap)() }),
  () => [
    ...(function* () {
      throw new Error("inner");
    })(),
  ],
  () => [...(() => lib.boom())()],
  () => [...(lib.trap, lib).boom()],
  () => [...(-1, lib.boom)()],
  () => [...(lib.list || other.list)],
  () => [...(lib, other.list)],
  () => [...(kept = lib.boom())],
  () => [...lib.boom()],
  async () => [...(await make()).list],
  async () => [...(await lib.list)],
  () => ({ ...(lib ?? other).trap() }),
  async () => ({ ...(await make()).trap() }),
  () => take(1, ...(lib ?? other).boom()),
  async () => take(...(await make()).boom()),
  () => [...(lib || other)["boom"]()],
  () => [...(lib?.boom)()],
  () => [...(flag && lib).boom()],
  () => [...(lib ?? other).boom(), 2],
  () => [...(lib ?? other).boom()],
  () => [.../* note */ (lib ?? other).boom()],
  () => [...(lib ?? other).boom()],
  () => [...(typeof lib === "object" ? lib : other).list],
  () => [...(!lib || lib).list],
  () => [...(new Taker(), lib).list],
];
let index = 0;
for (const form of forms) {
  index++;
  try {
    await form();
    console.log(index, "no error");
  } catch (error) {
    console.log(
      index,
      error.stack
        .split("\n")
        .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\][\w.-]+:(\d+):(\d+)\)?$/.exec(text))
        .filter(found => found !== null)
        .map(found => found[1] + "@" + found[2] + ":" + found[3])
        .join(" < "),
    );
  }
}

// GENERATED: Taker boom trap list make take
// CHECK-LABEL: function {{*}}name="Taker"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasRestParameter, HasNewTarget, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = TypeTest v5 testedType=object
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b4(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="boom"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<never> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="Error" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="boom"
// CHECK-NEXT: v7 = Construct v5, -, v6 calleeName="Error"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: Throw v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="trap"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_3]] flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_3]]
// CHECK-NEXT: v1 = NewClosure function=[[f_5]]
// CHECK-NEXT: DefineGetter v0, v1 key="value"
// CHECK-NEXT: v3 = FinishObject v0
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="list"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<never> flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="lib"
// CHECK-NEXT: v2 = PropGet v1 key="boom"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1 calleeKey="boom" calleeName="lib.boom"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|Generator<never> flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|[[L_7]]> flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="lib"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
