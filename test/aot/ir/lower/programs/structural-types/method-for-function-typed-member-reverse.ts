// RUN: lower
// OPTIONS: builtin-modules

// A method for a function typed member and the reverse.
interface WithProperty {
  id: number;
  compute: (n: number) => number;
}

interface WithMethod {
  id: number;
  compute(n: number): number;
}

class MethodForm {
  id = 1;
  compute(n: number): number {
    return n + this.id;
  }
}

class ArrowField {
  id = 2;
  compute = (n: number): number => n * 10 + this.id;
}

class FunctionField {
  id = 3;
  compute = function (this: void, n: number): number {
    return n * 100;
  };
}

class GetterForm {
  id = 4;
  fetched = 0;
  get compute(): (n: number) => number {
    this.fetched++;
    return n => n * 1000 + this.fetched;
  }
}

class StaticBorrowed {
  id = 5;
  compute = Math.abs;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function callProperty(o: WithProperty): number {
  return o.compute(-7);
}

function callMethod(o: WithMethod): number {
  return o.compute(-7);
}

function detachProperty(o: WithProperty): number {
  const f = o.compute;
  return f(-7);
}

function detachMethod(o: WithMethod): number {
  const { compute } = o;
  return compute(-7);
}

function where(o: WithMethod): string {
  return Object.hasOwn(o, "compute") + " " + Object.keys(o).join() + " " + JSON.stringify(o) + " " + Object.keys({ ...o }).join();
}

function makers(): [string, () => WithProperty & WithMethod][] {
  return [
    ["a method", () => new MethodForm()],
    ["an arrow in a field", () => new ArrowField()],
    ["a function in a field", () => new FunctionField()],
    ["a getter that returns a function", () => new GetterForm()],
    ["a built-in in a field", () => new StaticBorrowed()],
    ["a literal with a method", () => ({ id: 6, compute(n: number) { return n - this.id; } })],
    ["a literal with an arrow", () => ({ id: 7, compute: (n: number) => n - 7 })],
  ];
}

for (const [label, make] of makers()) {
  attempt(label + ", called as a property", () => callProperty(make()));
  attempt(label + ", called as a method", () => callMethod(make()));
  attempt(label + ", taken off as a property", () => detachProperty(make()));
  attempt(label + ", taken off as a method", () => detachMethod(make()));
  attempt(label + ", where it lives", () => where(make()));
  attempt(label + ", on a copy", () => {
    const copy = { ...make() };
    return typeof copy.compute;
  });
  attempt(label + ", replaced", () => {
    const o = make();
    o.compute = n => n;
    return callProperty(o) + " " + callMethod(o) + " " + Object.hasOwn(o, "compute");
  });
  attempt(label + ", called with another this", () => make().compute.call({ id: 1000 }, -7));
}

const honest = new MethodForm();
let total = 0;
for (let i = 0; i < 2000; i++) total += callMethod(honest) + callProperty(honest);
console.log("2000 honest: " + total);
console.log("then each at those sites: " + makers().map(([, make]) => callMethod(make()) + "/" + callProperty(make())).join());

const getter = new GetterForm();
callMethod(getter);
callProperty(getter);
console.log("the getter ran once a call: " + getter.fetched);

export {};

// GENERATED: detachMethod where MethodForm
// CHECK-LABEL: function {{*}}name="detachMethod"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="compute"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="compute"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_4]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Integer integer=-7
// CHECK-NEXT: v8 = Call v6, -, v7 calleeName="compute"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=number site=[[w_5]]}}, {declared={type=number site=[[w_3]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="where"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v3 = String string="compute"
// CHECK-NEXT: v4 = Call v2, v1, v0, v3 calleeName="Object.hasOwn"
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_8]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v10 = Call v9, v8, v0 calleeName="Object.keys"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|string> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = PropGet v11 key="join"
// CHECK-NEXT: v13 = Call v12, v11 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v7, v14
// CHECK-NEXT: v16 = String string=" "
// CHECK-NEXT: v17 = Add v15, v16
// CHECK-NEXT: v18 = Builtin builtin=JSON
// CHECK-NEXT: v19 = PropGet v18 key="stringify"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v20, v18, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Add v17, v22
// CHECK-NEXT: v24 = String string=" "
// CHECK-NEXT: v25 = Add v23, v24
// CHECK-NEXT: v26 = Builtin builtin=Object
// CHECK-NEXT: v27 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v28 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v28, v0
// CHECK-NEXT: v30 = FinishObject v28
// CHECK-NEXT: v31 = Call v27, v26, v30 calleeName="Object.keys"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|Array<undefined|null|string> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v33 = PropGet v32 key="join"
// CHECK-NEXT: v34 = Call v33, v32 calleeKey="join" calleeName="join"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v36 = Add v25, v35
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="MethodForm"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_12]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_13]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
