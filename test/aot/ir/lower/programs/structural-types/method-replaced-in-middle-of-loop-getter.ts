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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = Data data=[[d_2]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v4)
// CHECK-NEXT: b1(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Less v5, v7
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = PropGet v2 key="push"
// CHECK-NEXT: v10 = PropGet v0 key="at"
// CHECK-NEXT: v11 = Call v10, v0, v5 calleeKey="at" calleeName="l.at"
// CHECK-NEXT: v12 = Call v9, v2, v11 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v13 = Convert v12 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = Increment v5
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v15)
// CHECK-NEXT: b3():
// CHECK-NEXT: v16 = PropGet v2 key="map"
// CHECK-NEXT: v17 = NewClosure function=[[f_3]]
// CHECK-NEXT: v18 = Call v16, v2, v17 calleeKey="map" calleeName="seen.map"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v20 = PropGet v19 key="join"
// CHECK-NEXT: v21 = String string=" "
// CHECK-NEXT: v22 = Call v20, v19, v21 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v22 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Gauge"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="at"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_1]]} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="items"
// CHECK-NEXT: v3 = ElemGet v2, v1
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="items"
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = ElemGet v1, v2
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = PropGet v0 key="items"
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: ElemSet v6, v7, v8
// CHECK-NEXT: v10 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: PropSet v0, v10 key="at"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = PropGet v0 key="items"
// CHECK-NEXT: v13 = PropGet v12 key="length"
// CHECK-NEXT: v14 = Convert v13 declared={type=number}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
