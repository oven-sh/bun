// RUN: lower
// OPTIONS: builtin-modules

// Typed functions that take the class above are handed objects of that class, of classes below it, and of classes below a mixin over it.
type Constructor<T = {}> = new (...args: any[]) => T;
class Emitter { listeners = 0; count = 1; on(): this { this.listeners++; return this; } total(): number { return this.count + this.listeners; } }
class Direct extends Emitter { direct = 10; total(): number { return super.total() + this.direct; } }
function Countable<TBase extends Constructor<Emitter>>(Base: TBase) { return class extends Base { n = 100; total(): number { return super.total() + this.n; } grow(): number { return ++this.n; } }; }
function Named<TBase extends Constructor>(Base: TBase) { return class extends Base { name = "x"; label(): string { return this.name + "!"; } }; }
class A extends Countable(Emitter) { a = 1000; }
class B extends Named(Countable(Direct)) { b = 2000; }
class C extends Countable(Named(Emitter)) {}
interface HasTotal { total(): number }
function viaClass(e: Emitter): number { return e.on().total() + e.count; }
function viaInterface(e: HasTotal): number { return e.total(); }
function fields(e: Emitter): string { return Object.keys(e).join(","); }
const all: Emitter[] = [new Emitter(), new Direct(), new A(), new B(), new C()];
const lines: (string | number)[] = [];
let sum = 0;
for (let round = 0; round < 200; round++) for (const e of all) sum += viaClass(e) + viaInterface(e);
lines.push(sum);
for (const e of all) lines.push(fields(e));
const a = new A(), b = new B(), c = new C();
lines.push(a.grow() + a.a, b.grow() + b.b + b.direct, b.label(), c.grow(), c.label());
lines.push(String(a instanceof Emitter), String(b instanceof Direct), String(c instanceof Direct));
console.log(lines.join(" "));

// GENERATED: Countable fields Emitter total Direct
// CHECK-LABEL: function {{*}}name="Countable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=undefined|null|[[f_3]] site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ResolveHeritage v0
// CHECK-NEXT: v2 = NewClosure function=[[f_5]]
// CHECK-NEXT: v3 = NewClass v2, v0, v1 layout=[[L_6]]
// CHECK-NEXT: v4 = NewClosure v3 function=[[f_7]]
// CHECK-NEXT: DefineMethod v3, v4 layout=[[L_6]] key="total"
// CHECK-NEXT: v6 = NewClosure function=[[f_8]]
// CHECK-NEXT: DefineMethod v3, v6 layout=[[L_6]] index=1 key="grow"
// CHECK-NEXT: v8 = FinishClass v3 layout=[[L_6]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_3]] site=[[w_4]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fields"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = String string=","
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Emitter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_14]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_9]] site=[[w_15]]} results=[{type=number site=[[w_16]]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = PropGet v0 key="listeners"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_16]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Direct"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_19]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_19]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_20]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_19]] site=[[w_21]]} results=[{type=number site=[[w_22]]}] functionTypes={{*}}[[f_23]]] {
// CHECK-NEXT: b0(v0: [[L_19]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_24]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="total"
// CHECK-NEXT: v4 = Call v3, v0 calleeName="super.total"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_25]]}
// CHECK-NEXT: v6 = PropGet v0 key="direct"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_22]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}] thisType={type=[[L_6]] site=[[w_26]]} results=[{type=number site=[[w_27]]}] functionTypes={{*}}[[f_28]]] {
// CHECK-NEXT: b0(v0: function, v1: [[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v1 key="total"
// CHECK-NEXT: v4 = Call v3, v1 calleeName="super.total"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_29]]}
// CHECK-NEXT: v6 = PropGet v1 key="n"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_27]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
