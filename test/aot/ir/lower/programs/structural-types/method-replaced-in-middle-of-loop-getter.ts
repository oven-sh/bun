// RUN: lower
// OPTIONS: builtin-modules

// A method is replaced in the middle of a loop by a getter.
class Gauge {
  reads = 0;
  level(): string {
    return "method";
  }
  get tick(): number {
    this.reads++;
    if (this.reads === 3) this.level = () => "own";
    if (this.reads === 5) Reflect.deleteProperty(this, "level");
    if (this.reads === 7) Gauge.prototype.level = () => "patched";
    if (this.reads === 9) Gauge.prototype.level = original;
    return this.reads;
  }
}

const original = Gauge.prototype.level;

function walk(g: Gauge, rounds: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < rounds; i++) seen.push(g.level() + " " + g.tick + " " + g.level());
  return seen;
}

for (const line of walk(new Gauge(), 10)) console.log("in a function: " + line);

const direct = new Gauge();
for (let i = 0; i < 10; i++) console.log("at the top: " + direct.level() + " " + direct.tick + " " + direct.level());

class Late {
  reads = 0;
  level(): string {
    return "method";
  }
  get tick(): number {
    this.reads++;
    if (this.reads === 2001) this.level = () => "own";
    if (this.reads === 2003) Reflect.deleteProperty(this, "level");
    return this.reads;
  }
}

function walkLate(g: Late, rounds: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < rounds; i++) {
    const before = g.level();
    const at = g.tick;
    seen.push(before + " " + at + " " + g.level());
  }
  return seen;
}

for (const line of walkLate(new Late(), 2004).slice(-6)) console.log("after 2000 rounds: " + line);

class Lengths {
  items: number[] = [1, 2, 3, 4, 5, 6];
  at(i: number): number {
    return this.items[i];
  }
  get length(): number {
    if (this.items[0] === 1) {
      this.items[0] = 0;
      this.at = i => -this.items[i];
    }
    return this.items.length;
  }
}

function total(l: Lengths): string {
  const seen: number[] = [];
  for (let i = 0; i < l.length; i++) seen.push(l.at(i));
  return seen.map(n => (Object.is(n, -0) ? "-0" : String(n))).join(" ");
}

console.log("the getter in the loop's condition: " + total(new Lengths()));

export {};

// GENERATED: total Gauge at length
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_4]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<number> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Jump -> next b2(v4)
// CHECK-NEXT: b2(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Less v5, v8
// CHECK-NEXT: Branch v9 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = PropGet v2 key="push"
// CHECK-NEXT: v12 = PropGet v0 key="at"
// CHECK-NEXT: v13 = Call v12, v0, v10 calleeKey="at" calleeName="l.at"
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_8]]}
// CHECK-NEXT: v15 = Call v11, v2, v14 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_9]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = Increment v10
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Jump -> next b2(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v20 = PropGet v2 key="map"
// CHECK-NEXT: v21 = NewClosure function=[[f_10]]
// CHECK-NEXT: v22 = Call v20, v2, v21 calleeKey="map" calleeName="seen.map"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|Array<undefined|null|string> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v24 = PropGet v23 key="join"
// CHECK-NEXT: v25 = String string=" "
// CHECK-NEXT: v26 = Call v24, v23, v25 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v26 casts=[{declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Gauge"
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
// CHECK-LABEL: function {{*}}name="at"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_1]] site=[[w_14]]} parameters=[{type=number site=[[w_15]]}] results=[{type=number site=[[w_16]]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="items"
// CHECK-NEXT: v3 = ElemGet v2, v1
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_18]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_19]]} results=[{type=number site=[[w_20]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="items"
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = ElemGet v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_21]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = StrictEq v4, v5
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = PropGet v0 key="items"
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_22]]}
// CHECK-NEXT: ElemSet v7, v8, v10
// CHECK-NEXT: v12 = NewClosure v0 function=[[f_23]]
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_17]] site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v13 key="at"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = PropGet v0 key="items"
// CHECK-NEXT: v16 = PropGet v15 key="length"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_25]]} illTypedCause=Assertion
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
