// RUN: lower
// OPTIONS: builtin-modules

// A method is replaced by an async function.
const log: string[] = [];

class Store {
  items: string[] = [];
  save(item: string): void {
    this.items.push(item);
    log.push("saved " + item);
  }
  load(): Promise<number> {
    log.push("load");
    return Promise.resolve(this.items.length);
  }
  size(): number | Promise<number> {
    return this.items.length;
  }
  fail(): Promise<string> {
    throw new RangeError("thrown at once");
  }
}

function describe(value: unknown): string {
  return value instanceof Promise ? "a promise" : typeof value + " " + String(value);
}

function saveTo(s: Store, item: string): string {
  const result: unknown = s.save(item);
  return describe(result);
}

function sizeOf(s: Store): string {
  return describe(s.size());
}

async function failOf(s: Store): Promise<string> {
  let made = "nothing";
  try {
    const promise = s.fail();
    made = "a promise came back";
    return made + ", " + (await promise);
  } catch (error) {
    return made + ", caught " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

async function round(label: string, s: Store): Promise<void> {
  console.log(label + ", save: " + saveTo(s, "a"));
  console.log(label + ", size: " + sizeOf(s) + ", awaited " + (await s.size()));
  console.log(label + ", load: " + describe(s.load()) + ", awaited " + (await s.load()));
  console.log(label + ", fail: " + (await failOf(s)));
  await null;
  console.log(label + ", log: " + log.join(", "));
  log.length = 0;
}

const s = new Store();
for (let i = 0; i < 2000; i++) {
  saveTo(s, "w");
  sizeOf(s);
}
s.items.length = 0;
log.length = 0;
await round("methods", s);

s.save = async function (item) {
  await null;
  log.push("saved later " + item);
};
s.size = async () => -1;
s.load = async () => {
  log.push("own load");
  return -2;
};
s.fail = async () => {
  throw new TypeError("rejected");
};
await round("own async functions", s);

for (const name of ["save", "size", "load", "fail"]) Reflect.deleteProperty(s, name);
await round("uncovered", s);

const originalSave = Store.prototype.save;
const originalFail = Store.prototype.fail;
Store.prototype.save = async function (item) {
  this.items.push(item + "!");
  log.push("prototype saved " + item);
};
Store.prototype.fail = async function () {
  return "no failure, " + this.items.length + " items";
};
await round("async functions on the prototype", s);

Store.prototype.save = originalSave;
Store.prototype.fail = originalFail;
await round("put back", s);

export {};

// GENERATED: failOf Store load fail
// CHECK-LABEL: function {{*}}name="failOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="nothing"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4(v3):
// CHECK-NEXT: v4 = PropGet v1 key="fail"
// CHECK-NEXT: v5 = Call v4, v1 calleeKey="fail" calleeName="s.fail"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = String string="a promise came back"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b4(v8):
// CHECK-NEXT: v9 = String string=", "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Await v6, v1
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v13 = Add v10, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string|object site=[[w_5]]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: b4(v15: undefined|null|string) role=CatchHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = String string=", caught "
// CHECK-NEXT: v18 = Add v15, v17
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="Error" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v22 = InstanceOf v16, v21 writtenExpression="error instanceof Error"
// CHECK-NEXT: v23 = ToBoolean v22
// CHECK-NEXT: Branch v23 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v25 = Convert v16 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="constructor"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|function site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = PropGet v27 key="name"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v29)
// CHECK-NEXT: b7(v30):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v31 = TypeOf v16
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = Add v18, v32
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string|object site=[[w_5]]}
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Store"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_7]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_8]]} results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="load"
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_11]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="Promise" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="resolve"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v0 key="items"
// CHECK-NEXT: v13 = PropGet v12 key="length"
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Call v11, v9, v14 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="thrown at once"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
