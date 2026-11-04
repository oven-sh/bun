// RUN: lower
// OPTIONS: builtin-modules

// A derived constructor has read its argument, calls super(), which damages that argument, and reads it again. Behind super() it also reads fields of `this` that the base constructor has stored and then damaged.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
class Base {
  base: number;
  constructor(p: Point) {
    this.base = p.y;
    if (strikes) {
      delete (p as any).x;
      (this as any).base = "text";
    }
  }
}
class Derived extends Base {
  told: string;
  constructor(p: Point) {
    const before = p.x;
    super(p);
    this.told = before + ">" + p.x + " " + this.base;
  }
}

function holder(p: Point): string {
  const before = p.x;
  const d = new Derived(p);
  return before + " " + d.told + " " + d.base + " " + p.x;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}

// GENERATED: Base Derived
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: v6 = PropGet v1 key="y"
// CHECK-NEXT: PropSet v4, v6 key="base"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="strikes"
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b1(| 0), notTaken b2()
// CHECK-NEXT: b1(v11):
// CHECK-NEXT: v12 = PropDelete v1 key="x"
// CHECK-NEXT: v13 = String string="text"
// CHECK-NEXT: PropSet v4, v13 key="base"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = TypeTest v15 testedType=object
// CHECK-NEXT: Branch v16 -> taken b3(| 0), notTaken b4(v4)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4(v17)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|[[L_1]]):
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = PropGet v2 key="x"
// CHECK-NEXT: v5 = GetSuperBase v0
// CHECK-NEXT: v6 = SuperConstruct v5, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_7]]}
// CHECK-NEXT: v8 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b13(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_8]]
// CHECK-NEXT: v11 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = String string=">"
// CHECK-NEXT: v16 = Add v4, v15
// CHECK-NEXT: v17 = PropGet v2 key="x"
// CHECK-NEXT: v18 = Add v16, v17
// CHECK-NEXT: v19 = String string=" "
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v21 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v22):
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: v25 = PropGet v24 key="base"
// CHECK-NEXT: v26 = Add v20, v25
// CHECK-NEXT: PropSet v14, v26 key="told"
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: v29 = TypeTest v28 testedType=object
// CHECK-NEXT: Branch v29 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v30):
// CHECK-NEXT: Jump -> next b11(v30)
// CHECK-NEXT: b7(v31):
// CHECK-NEXT: v32 = TypeTest v31 testedType=undefined
// CHECK-NEXT: Branch v32 -> taken b8(| 0), notTaken b12(| 0)
// CHECK-NEXT: b8(v33):
// CHECK-NEXT: v34 = TypeTest v24 testedType=absent
// CHECK-NEXT: Branch v34 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v35):
// CHECK-NEXT: v36 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v36
// CHECK-NEXT: b10(v37):
// CHECK-NEXT: Jump -> next b11(v37)
// CHECK-NEXT: b11(v38):
// CHECK-NEXT: Return v38
// CHECK-NEXT: b12(v39):
// CHECK-NEXT: v40 = NewRuntimeError runtimeError=DerivedConstructorResult name="Derived"
// CHECK-NEXT: Throw v40
// CHECK-NEXT: b13(v41):
// CHECK-NEXT: v42 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v42
// CHECK-NEXT: }
