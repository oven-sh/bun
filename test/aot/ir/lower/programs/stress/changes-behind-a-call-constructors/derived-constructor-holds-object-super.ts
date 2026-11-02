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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_5]]
// CHECK-NEXT: v6 = PropGet v1 key="y"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_6]]}
// CHECK-NEXT: PropSet v4, v7 key="base"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="strikes"
// CHECK-NEXT: v11 = ToBoolean v10
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v13 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropDelete v13 key="x"
// CHECK-NEXT: v15 = Convert v4 declared={type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="text"
// CHECK-NEXT: PropSet v15, v16 key="base"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: Jump -> next b8(v21)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: Jump -> next b8(v4)
// CHECK-NEXT: b8(v23):
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = PropGet v2 key="x"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v6 = GetSuperBase v0
// CHECK-NEXT: v7 = SuperConstruct v6, v1, v2 layout=[[L_13]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b14(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = CallDirect v8 function=[[f_14]]
// CHECK-NEXT: v12 = TypeTest v8 testedType=absent
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v13) frequency=Unlikely:
// CHECK-NEXT: v14 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v14
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = String string=">"
// CHECK-NEXT: v17 = Add v5, v16
// CHECK-NEXT: v18 = PropGet v2 key="x"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = String string=" "
// CHECK-NEXT: v21 = Add v19, v20
// CHECK-NEXT: v22 = TypeTest v15 testedType=absent
// CHECK-NEXT: Branch v22 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v23) frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = PropGet v25 key="base"
// CHECK-NEXT: v27 = Add v21, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v15, v28 key="told"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: v31 = TypeTest v30 testedType=object
// CHECK-NEXT: Branch v31 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v32):
// CHECK-NEXT: Jump -> next b12(v32)
// CHECK-NEXT: b8(v33):
// CHECK-NEXT: v34 = TypeTest v33 testedType=undefined
// CHECK-NEXT: Branch v34 -> taken b9(| 0), notTaken b13(| 0)
// CHECK-NEXT: b9(v35):
// CHECK-NEXT: v36 = TypeTest v25 testedType=absent
// CHECK-NEXT: Branch v36 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v37) frequency=Unlikely:
// CHECK-NEXT: v38 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v38
// CHECK-NEXT: b11(v39):
// CHECK-NEXT: Jump -> next b12(v39)
// CHECK-NEXT: b12(v40):
// CHECK-NEXT: Return v40
// CHECK-NEXT: b13(v41) frequency=Unlikely:
// CHECK-NEXT: v42 = NewRuntimeError runtimeError=DerivedConstructorResult name="Derived"
// CHECK-NEXT: Throw v42
// CHECK-NEXT: b14(v43) frequency=Unlikely:
// CHECK-NEXT: v44 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v44
// CHECK-NEXT: }
