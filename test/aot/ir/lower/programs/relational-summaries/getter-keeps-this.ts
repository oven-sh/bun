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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: v2 = Negate v0
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_3]] fields=[0, 1]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = Add v0, v9
// CHECK-NEXT: v11 = NewArray v0, v8, v10 contents=number
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<number> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = NewClosure v6, v12 function=[[f_6]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Greater v0, v15
// CHECK-NEXT: Branch v16 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v17):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = Sub v17, v19
// CHECK-NEXT: v21 = Call v18, -, v20 calleeName="churn"
// CHECK-NEXT: v22 = Convert v21 declared={type=number site=[[w_10]]}
// CHECK-NEXT: v23 = Call v14 calleeName="read"
// CHECK-NEXT: v24 = Convert v23 declared={type=number site=[[w_11]]}
// CHECK-NEXT: v25 = Add v22, v24
// CHECK-NEXT: v26 = Convert v25 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v26
// CHECK-NEXT: b4(v27):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="Bun" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="gc"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(BunGc) flags=[IsExpected]}
// CHECK-NEXT: v33 = Boolean boolean=true
// CHECK-NEXT: v34 = Call v32, v30, v33 calleeKey="gc" calleeName="Bun.gc"
// CHECK-NEXT: v35 = Call v14 calleeName="read"
// CHECK-NEXT: ReturnCall v35 casts=[{declared={type=number site=[[w_12]]}}, {declared={type=number site=[[w_2]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="LoudHeir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1 layout=[[L_15]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_16]]
// CHECK-NEXT: PropSet v6, v2 key="tag"
// CHECK-NEXT: v11 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12) frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = Convert v2 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v14, v15 key="tag"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v18 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: Jump -> next b10(v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = TypeTest v20 testedType=undefined
// CHECK-NEXT: Branch v21 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v23 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v24) frequency=Unlikely:
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v25
// CHECK-NEXT: b9(v26):
// CHECK-NEXT: Jump -> next b10(v26)
// CHECK-NEXT: b10(v27):
// CHECK-NEXT: Return v27
// CHECK-NEXT: b11(v28) frequency=Unlikely:
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=DerivedConstructorResult name="LoudHeir"
// CHECK-NEXT: Throw v29
// CHECK-NEXT: b12(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v31
// CHECK-NEXT: }
