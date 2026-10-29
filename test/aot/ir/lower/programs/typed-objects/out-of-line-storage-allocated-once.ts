// RUN: lower
// OPTIONS: builtin-modules

// A function that stores to many fields which lie out of line takes their storage once. Nobody sees room that no field uses yet.
class Options {
  declare o0?: any; declare o1?: any; declare o2?: any; declare o3?: any; declare o4?: any; declare o5?: any; declare o6?: any; declare o7?: any; declare o8?: any; declare o9?: any; declare o10?: any; declare o11?: any; declare o12?: any; declare o13?: any; declare o14?: any; declare o15?: any; declare o16?: any; declare o17?: any; declare o18?: any; declare o19?: any; declare o20?: any; declare o21?: any; declare o22?: any; declare o23?: any;
  declare update: (given: any) => void;
  constructor(given: any) {
    this.update = (given: any) => {
      this.o0 = given.o0;
      this.o1 = given.o1;
      this.o2 = given.o2;
      this.o3 = given.o3;
      this.o4 = given.o4;
      this.o5 = given.o5;
      this.o6 = given.o6;
      this.o7 = given.o7;
      this.o8 = given.o8;
      this.o9 = given.o9;
      this.o10 = given.o10;
      this.o11 = given.o11;
      this.o12 = given.o12;
      this.o13 = given.o13;
      this.o14 = given.o14;
      this.o15 = given.o15;
      this.o16 = given.o16;
      this.o17 = given.o17;
      this.o18 = given.o18;
      this.o19 = given.o19;
      this.o20 = given.o20;
      this.o21 = given.o21;
      this.o22 = given.o22;
      this.o23 = given.o23;
    };
    this.update(given);
  }
}
function look(options: Options): string { return Object.keys(options).filter(key => key !== "update").join("") + ":" + Object.values(options).filter(value => typeof value !== "function").join(""); }
const full: Record<string, number> = {};
for (let i = 0; i < 24; i++) full["o" + i] = i % 10;
const kept: Options[] = [];
for (let i = 0; i < 20; i++) kept.push(new Options(full));
console.log(look(kept[0]));
const failing: Record<string, unknown> = { ...full };
Object.defineProperty(failing, "o9", { get() { throw new RangeError("nine"); }, enumerable: true });
let half: Options | undefined;
class Watched extends Options { constructor(given: any) { try { super(given); } catch (error) { console.log((error as Error).message); throw error; } } }
try { new Watched(failing); } catch (error) { console.log(error instanceof RangeError); }
const later = new Options({});
console.log(look(later), "o3" in later, later.o3, Object.keys(later).length);
try { later.update(failing); } catch (error) { console.log((error as Error).message, look(later), "o9" in later, "o23" in later, later.o23); }
later.update({ o20: 5 });
console.log(look(later), later.o20, later.o9, Object.keys(later).length);
delete (later as any).o4; later.update(full);
console.log(look(later));
let garbage: Options[] = [];
for (let round = 0; round < 60; round++) { garbage = []; for (let i = 0; i < 300; i++) garbage.push(new Options(full)); }
console.log(look(garbage[299]) === look(kept[0]), look(kept[19]) === look(kept[0]), JSON.stringify(later).length, half);
class Bare {
  declare o0?: any; declare o1?: any; declare o2?: any; declare o3?: any; declare o4?: any; declare o5?: any; declare o6?: any; declare o7?: any; declare o8?: any; declare o9?: any; declare o10?: any; declare o11?: any; declare o12?: any; declare o13?: any; declare o14?: any; declare o15?: any; declare o16?: any; declare o17?: any; declare o18?: any; declare o19?: any; declare o20?: any; declare o21?: any; declare o22?: any; declare o23?: any;
  fill(given: any): void {
    this.o0 = given.o0;
    this.o1 = given.o1;
    this.o2 = given.o2;
    this.o3 = given.o3;
    this.o4 = given.o4;
    this.o5 = given.o5;
    this.o6 = given.o6;
    this.o7 = given.o7;
    this.o8 = given.o8;
    this.o9 = given.o9;
    this.o10 = given.o10;
    this.o11 = given.o11;
    this.o12 = given.o12;
    this.o13 = given.o13;
    this.o14 = given.o14;
    this.o15 = given.o15;
    this.o16 = given.o16;
    this.o17 = given.o17;
    this.o18 = given.o18;
    this.o19 = given.o19;
    this.o20 = given.o20;
    this.o21 = given.o21;
    this.o22 = given.o22;
    this.o23 = given.o23;
  }
}
const bare = new Bare();
console.log(Object.keys(bare).length, "o0" in bare);
try { bare.fill(failing); } catch (error) { console.log((error as Error).message, Object.keys(bare).join(""), Object.values(bare).join(""), "o9" in bare, "o23" in bare, bare.o9, bare.o23, JSON.stringify(bare)); }
const copy = { ...bare };
console.log(Object.keys(copy).join(""), Object.getOwnPropertyNames(bare).length);
bare.o23 = "last"; bare.o12 = "middle";
console.log(Object.keys(bare).join(""), bare.o23, bare.o12, bare.o13, "o13" in bare);
bare.fill(full);
console.log(Object.keys(bare).join(""), Object.values(bare).join(""));

// GENERATED: Bare get Watched
// CHECK-LABEL: function {{*}}name="Bare"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="nine"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Watched"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b14():
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b3(| 0), notTaken b13(| 0)
// CHECK-NEXT: b3(v8) handler=b14():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: Jump -> next b11(v11)
// CHECK-NEXT: b7(v12):
// CHECK-NEXT: v13 = TypeTest v12 testedType=undefined
// CHECK-NEXT: Branch v13 -> taken b8(| 0), notTaken b12(| 0)
// CHECK-NEXT: b8(v14):
// CHECK-NEXT: v15 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v15 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v16) frequency=Unlikely:
// CHECK-NEXT: v17 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v17
// CHECK-NEXT: b10(v18):
// CHECK-NEXT: Jump -> next b11(v18)
// CHECK-NEXT: b11(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: b12(v20) frequency=Unlikely:
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=DerivedConstructorResult name="Watched"
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b13(v22) frequency=Unlikely handler=b14():
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b14() role=CatchHandler:
// CHECK-NEXT: v24 = CatchValue
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = Convert v24 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v31 = PropGet v30 key="message"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v33 = Call v29, v27, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
