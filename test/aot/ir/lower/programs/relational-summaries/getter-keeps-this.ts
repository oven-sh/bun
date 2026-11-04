// RUN: lower
// OPTIONS: builtin-modules

// A callee that only reads a member of its parameter keeps the object all the same where the member is a getter that stores `this`. The caller's object may then lie in no frame and be no scalars.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface HasX {
  x: number;
  tag: string;
}
const kept: { tag: string }[] = [];
class Plain {
  constructor(
    public x: number,
    public tag: string,
  ) {}
}
class Spy {
  constructor(
    public hidden: number,
    public tag: string,
  ) {}
  get x(): number {
    kept.push(this);
    return this.hidden;
  }
}
class QuietBase {
  tag = "quiet";
  get x(): number {
    return 1;
  }
}
class LoudHeir extends QuietBase {
  constructor(public tag: string) {
    super();
    this.tag = tag;
  }
  get x(): number {
    kept.push(this);
    return super.x + 1;
  }
}
function readX(p: HasX): number {
  return p.x + 1;
}
function readTwice(p: HasX): number {
  return readX(p) + readX(p);
}
function readThroughThree(p: HasX): number {
  return readTwice(p) - readX(p);
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  sum += readThroughThree(new Plain(i, "plain" + i));
  sum += readThroughThree({ x: i, tag: "literal" + i });
  if (i % 100 === 99) sum += readThroughThree(new Spy(i, "spy" + i));
  if (i % 100 === 50) {
    sum += readThroughThree({
      get x() {
        kept.push(this);
        return i;
      },
      tag: "literal with a getter " + i,
    });
  }
  if (i % 100 === 75) sum += readThroughThree(new LoudHeir("heir" + i));
  if (i % 100 === 25) sum += readThroughThree(new QuietBase());
}
console.log(sum, churn(60), kept.length);
for (let i = 0; i < kept.length; i += 3) console.log(kept[i].tag, kept[i] === kept[i + 1], kept[i + 1] === kept[i + 2], i + 3 < kept.length && kept[i] === kept[i + 3]);

// The getter arrives late, on the prototype of a class, under a name that its instances may have or lack.
class Sparse {
  declare y?: number;
  constructor(public tag: string) {}
}
function withY(tag: string, y: number): Sparse {
  const made = new Sparse(tag);
  made.y = y;
  return made;
}
function readY(p: Sparse): number {
  return p.y === undefined ? -1 : p.y;
}
const late: Sparse[] = [];
let answers = "";
for (let i = 0; i < 60; i++) {
  if (i === 40) {
    Object.defineProperty(Sparse.prototype, "y", {
      get() {
        late.push(this);
        return 1000;
      },
      set(value: number) {
        Object.defineProperty(this, "y", { value, writable: true, enumerable: true, configurable: true });
      },
      configurable: true,
    });
  }
  if (i === 43) delete Sparse.prototype.y;
  const answer = readY(new Sparse("without y " + i)) + readY(withY("with y " + i, i));
  if (i >= 38 && i < 45) answers += answer + " ";
}
console.log(answers, churn(60));
console.log(late.map(o => o.tag).join(" | "));

// GENERATED: churn LoudHeir
// CHECK-LABEL: function {{*}}name="churn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Negate v0
// CHECK-NEXT: v2 = NewObject -, v0, v1 layout=[[L_1]] fields=[0, 1]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v0, v4
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = NewArray v0, v5, v7 contents=anything
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = Greater v0, v9
// CHECK-NEXT: Branch v10 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Sub v0, v12
// CHECK-NEXT: v14 = Call v11, -, v13 calleeName="churn"
// CHECK-NEXT: v15 = CallDirect v3, v8 function=[[f_3]]
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="Bun" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="gc"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(BunGc) flags=[IsExpected]}
// CHECK-NEXT: v23 = Boolean boolean=true
// CHECK-NEXT: v24 = Call v22, v20, v23 calleeKey="gc" calleeName="Bun.gc"
// CHECK-NEXT: v25 = CallDirect v3, v8 function=[[f_3]]
// CHECK-NEXT: ReturnCall v25 casts=[{declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="LoudHeir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|string):
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1 layout=[[L_5]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_5]]}
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b11(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_6]]
// CHECK-NEXT: PropSet v6, v2 key="tag"
// CHECK-NEXT: v11 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: PropSet v14, v2 key="tag"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Jump -> next b9(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined
// CHECK-NEXT: Branch v20 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v23):
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b8(v25):
// CHECK-NEXT: Jump -> next b9(v25)
// CHECK-NEXT: b9(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: b10(v27):
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=DerivedConstructorResult name="LoudHeir"
// CHECK-NEXT: Throw v28
// CHECK-NEXT: b11(v29):
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
