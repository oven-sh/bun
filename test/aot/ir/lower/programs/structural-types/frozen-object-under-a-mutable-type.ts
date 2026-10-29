// RUN: lower
// OPTIONS: builtin-modules

interface Point {
  x: number;
  y: number;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function setX(p: Point, value: number): number {
  p.x = value;
  return p.x;
}

function setBoth(p: Point): string {
  p.y = -2;
  p.x = -1;
  return "stored";
}

function make(): Point {
  return Object.freeze({ x: 1, y: 2 });
}

class Holder {
  point: Point;
  constructor(point: Point) {
    this.point = point;
  }
  move(): number {
    this.point.x += 10;
    return this.point.x;
  }
}

const local: Point = Object.freeze({ x: 1, y: 2 });
attempt("local", () => {
  local.x = 5;
  return local.x;
});
console.log("local afterwards: " + JSON.stringify(local));

attempt("parameter", () => setX(local, 6));
attempt("two stores, the first one throws", () => setBoth(local));
console.log("afterwards: " + JSON.stringify(local));
attempt("result", () => {
  const made = make();
  made.y = 7;
  return made.y;
});
attempt("result stored to at once", () => (make().x = 8));
attempt("field", () => new Holder(local).move());
const list: Point[] = [{ x: 0, y: 0 }, local, { x: 0, y: 0 }];
attempt("element", () => (list[1].x = 9));
attempt("every element", () => {
  for (const p of list) p.y = 3;
  return "all stored";
});
console.log("the array afterwards: " + JSON.stringify(list));
const captured = () => {
  local.y = 10;
};
attempt("captured", captured);
attempt("Object.assign", () => JSON.stringify(Object.assign(local, { x: 11 })));
attempt("Reflect.set answers", () => Reflect.set(local, "x", 12));
attempt("defineProperty", () => JSON.stringify(Object.defineProperty(local, "x", { value: 13 })));
attempt("defineProperty with the same value", () => JSON.stringify(Object.defineProperty(local, "x", { value: 1 })));
attempt("setPrototypeOf", () => JSON.stringify(Object.setPrototypeOf(local, null)));
console.log("still: " + JSON.stringify(local) + " " + Object.isFrozen(local));

const frozenLater = { x: 1, y: 2 };
attempt("before it is frozen", () => setX(frozenLater, 2));
Object.freeze(frozenLater);
attempt("after it is frozen", () => setX(frozenLater, 3));
console.log("holds: " + JSON.stringify(frozenLater));

class Pair {
  x = 1;
  y = 2;
  constructor(freeze: boolean) {
    if (freeze) Object.freeze(this);
  }
  shift(): number {
    this.x++;
    return this.x;
  }
}

attempt("an open instance", () => new Pair(false).shift());
attempt("a frozen instance's own method", () => new Pair(true).shift());
attempt("a frozen instance as a Point", () => setX(new Pair(true), 4));

const shallow: { inner: Point; name: string } = Object.freeze({ inner: { x: 1, y: 2 }, name: "outer" });
attempt("a member of a member", () => setX(shallow.inner, 5));
attempt("the member itself", () => {
  shallow.inner = { x: 0, y: 0 };
  return "replaced";
});
console.log("shallow: " + JSON.stringify(shallow));

export {};

// GENERATED: make attempt Holder
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectFreeze
// CHECK-NEXT: v2 = Data data=[[d_3]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeName="Object.freeze"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|[[L_1]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v1 calleeName="body"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=": threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_11]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_11]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_12]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|[[L_1]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v4, v6 key="point"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
