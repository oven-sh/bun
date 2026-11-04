// RUN: lower
// OPTIONS: builtin-modules

// `this` of a derived constructor under arrow functions that are made before, in, behind and beside `super()`: each reads what plain Bun reads, or throws what plain Bun throws
function attempt(run: () => unknown): string {
  try { return String(run()); } catch (error) { return (error as Error).constructor.name; }
}
class Base { tag = "base"; constructor(public given?: unknown) {} }

class Behind extends Base { read: () => string; constructor() { super(); this.read = () => this.tag; } }
class Nested extends Base { read: () => () => string; constructor() { super(); this.read = () => () => this.tag; } }
class InLoop extends Base { all: (() => string)[] = []; constructor(n: number) { super(); for (let i = 0; i < n; i++) this.all.push(() => this.tag + i); } }
class InBranch extends Base { read: (() => string) | undefined; constructor(flag: boolean) { super(); if (flag) this.read = () => this.tag; } }
class Before extends Base { early: () => string; constructor() { const early = () => this.tag; super(); this.early = early; } }
class BeforeAndBehind extends Base {
  both: string;
  constructor() { const early = () => this; super(); const late = () => this; this.both = String(early() === late() && late() === this); }
}
class CalledTooEarly extends Base { constructor() { const early = () => this.tag; early(); super(); } }
class InArguments extends Base { constructor() { super(() => this.tag); } }
class CalledByBase extends Base { constructor() { super((() => this.tag)()); } }
// @ts-ignore
class Conditional extends Base { read: () => string; constructor(flag: boolean) { if (flag) super(); this.read = () => this.tag; } }
// @ts-ignore
class ShortCircuit extends Base { constructor(flag: boolean) { const read = () => this.tag; flag && super(); read(); } }
// @ts-ignore
class Ternary extends Base { read: () => unknown; constructor(flag: boolean) { flag ? super(1) : super(2); this.read = () => this.given; } }
// @ts-ignore
class InArrow extends Base { read: () => string; constructor() { const bind = () => { super(); }; bind(); this.read = () => this.tag; } }
// @ts-ignore
class InArrowLate extends Base { constructor(log: string[]) { const bind = () => { super(); }; const read = () => this.tag; log.push(attempt(read)); bind(); log.push(attempt(read)); } }
// @ts-ignore
class Twice extends Base { constructor(log: string[]) { super(1); const read = () => this.given; log.push(attempt(() => { super(2); })); log.push(attempt(read)); } }
// @ts-ignore
class TwiceInARow extends Base { constructor(log: string[]) { super(1); try { super(2); } catch (error) { log.push((error as Error).constructor.name); } const read = () => this.given; log.push(attempt(read)); } }
// @ts-ignore
class InTry extends Base { read: () => string; constructor() { try { super(); } finally { } this.read = () => this.tag; } }
class Thrower { constructor() { throw new RangeError("no"); } }
// @ts-ignore
class CatchesBase extends Thrower { constructor(log: string[]) { try { super(); } catch (error) { log.push((error as Error).constructor.name); } const read = () => this; log.push(attempt(read)); return {}; } }
// @ts-ignore
class Labeled extends Base { constructor(flag: boolean, log: string[]) { out: { if (flag) break out; super(); } const read = () => this.tag; log.push(attempt(read)); if (flag) super(); } }
// @ts-ignore
class InSwitch extends Base { constructor(k: number, log: string[]) { switch (k) { case 0: super(); } const read = () => this.tag; log.push(attempt(read)); if (k !== 0) super(); } }
class ReturnsEarly extends Base { read: (() => string) | undefined; constructor(flag: boolean) { if (flag) return { tag: "other", given: 0, read: undefined } as ReturnsEarly; super(); this.read = () => this.tag; } }
class Replaced { constructor() { return { tag: "replaced" }; } }
class BelowReplaced extends Replaced { declare tag: string; read: () => string; constructor() { super(); this.read = () => this.tag; } }
class BelowArray extends Array<number> { sum: () => number; constructor() { super(); this.push(1, 2, 3); this.sum = () => this.reduce((a, b) => a + b, 0); } }
class BelowError extends Error { describe: () => string; constructor(text: string) { super(text); this.describe = () => this.message + "!"; } }
class WithFields extends Base { field = () => this.tag; read: () => string; constructor() { super(); this.read = () => this.field() + this.tag; } }
class SuperMember extends Base { name() { return "m"; } }
class BelowSuperMember extends SuperMember { read: () => string; constructor() { super(); this.read = () => super.name() + this.tag; } name() { return "n"; } }
class Middle extends Base { middle: () => string; constructor() { super(); this.middle = () => this.tag + (this instanceof Bottom); } }
class Bottom extends Middle { bottom: () => string; constructor() { super(); this.tag = "bottom"; this.bottom = () => this.middle() + this.tag; } }

const log: string[] = [];
console.log(new Behind().read(), new Nested().read()(), new InLoop(3).all.map(f => f()).join(), new InBranch(true).read!(), String(new InBranch(false).read));
console.log(new Before().early(), new BeforeAndBehind().both, attempt(() => new CalledTooEarly()), (new InArguments().given as () => string)(), attempt(() => new CalledByBase()));
console.log(new Conditional(true).read(), attempt(() => new Conditional(false)), attempt(() => new ShortCircuit(true).tag), attempt(() => new ShortCircuit(false)));
console.log(new Ternary(true).read(), new Ternary(false).read(), new InArrow().read());
new InArrowLate(log); new Twice(log); new TwiceInARow(log); new CatchesBase(log);
console.log(new InTry().read(), log.join());
log.length = 0;
new Labeled(false, log); new Labeled(true, log); new InSwitch(0, log); new InSwitch(1, log);
console.log(log.join());
console.log(new ReturnsEarly(false).read!(), new ReturnsEarly(true).tag, new BelowReplaced().read(), new BelowArray().sum(), new BelowError("e").describe());
console.log(new WithFields().read(), new BelowSuperMember().read(), new Bottom().bottom(), new Middle().middle());

// GENERATED: InTry SuperMember late
// CHECK-LABEL: function {{*}}name="InTry"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = NewObject layout=[[L_2]]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b5():
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1 layout=[[L_3]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_3]]}
// CHECK-NEXT: v7 = GetEnvironmentField v3 layout=[[L_2]]
// CHECK-NEXT: v8 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v9) handler=b5():
// CHECK-NEXT: PutEnvironmentField v3, v6 layout=[[L_2]]
// CHECK-NEXT: v11 = CallDirect v6 function=[[f_4]]
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Jump -> next b6(v12, v13)
// CHECK-NEXT: b4(v14) handler=b5():
// CHECK-NEXT: v15 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b5() role=CleanupHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: Jump -> next b6(v17, v16)
// CHECK-NEXT: b6(v18, v19):
// CHECK-NEXT: Switch v18 cases=[0] -> case b7(), otherwise b17()
// CHECK-NEXT: b7():
// CHECK-NEXT: v20 = GetEnvironmentField v3 layout=[[L_2]]
// CHECK-NEXT: v21 = TypeTest v20 testedType=absent
// CHECK-NEXT: Branch v21 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v22):
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b9(v24):
// CHECK-NEXT: v25 = NewClosure v3 function=[[f_5]]
// CHECK-NEXT: PropSet v24, v25 key="read"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: v28 = TypeTest v27 testedType=object
// CHECK-NEXT: Branch v28 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v29):
// CHECK-NEXT: Jump -> next b15(v29)
// CHECK-NEXT: b11(v30):
// CHECK-NEXT: v31 = TypeTest v30 testedType=undefined
// CHECK-NEXT: Branch v31 -> taken b12(| 0), notTaken b16(| 0)
// CHECK-NEXT: b12(v32):
// CHECK-NEXT: v33 = GetEnvironmentField v3 layout=[[L_2]]
// CHECK-NEXT: v34 = TypeTest v33 testedType=absent
// CHECK-NEXT: Branch v34 -> taken b13(| 0), notTaken b14(| 0)
// CHECK-NEXT: b13(v35):
// CHECK-NEXT: v36 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v36
// CHECK-NEXT: b14(v37):
// CHECK-NEXT: Jump -> next b15(v37)
// CHECK-NEXT: b15(v38):
// CHECK-NEXT: Return v38
// CHECK-NEXT: b16(v39):
// CHECK-NEXT: v40 = NewRuntimeError runtimeError=DerivedConstructorResult name="InTry"
// CHECK-NEXT: Throw v40
// CHECK-NEXT: b17():
// CHECK-NEXT: Throw v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="SuperMember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=[[L_8]] variableName="this"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_8]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=absent
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
