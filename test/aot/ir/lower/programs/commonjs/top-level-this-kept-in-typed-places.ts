// RUN: lower
// OPTIONS: builtin-modules

// The top-level `this` of a TypeScript file that runs as CommonJS is its `module.exports`: an object literal, an array, a parameter, a field and a direct eval's scope take it without a TypeError.
let local: number = 1;
const holder = { self: this };
const list = [this];
function kindOf(value: unknown): string { return typeof value; }
class Keeper { kept: unknown = undefined; }
const keeper = new Keeper();
keeper.kept = this;
console.log(typeof this, typeof holder.self, holder.self === module.exports, typeof list[0], kindOf(this), keeper.kept === module.exports);
console.log(eval("local + 1"), eval("typeof this"));
eval("local = 5");
const inArrow = () => eval("typeof this + local");
console.log(local, inArrow());

// GENERATED: kindOf Keeper inArrow
// CHECK-LABEL: function {{*}}name="kindOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keeper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy, IsChecked] captures=[{type=env [[L_3]] flags=[IsFromCompiler]}, {type=anything variableName="this"}, {type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_3]], v1: anything, v2: object, v3: object):
// CHECK-NEXT: v4 = NewObject layout=[[L_4]]
// CHECK-NEXT: v5 = Null
// CHECK-NEXT: SetLiteralPrototype v4, v5
// CHECK-NEXT: v7 = FinishObject v4
// CHECK-NEXT: v8 = ScopeHasBinding v7 key="eval"
// CHECK-NEXT: Branch v8 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Jump -> next b5(v7, v9)
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = ScopeHasBinding v3 key="eval"
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Jump -> next b5(v3, v11)
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Jump -> next b5(v12, v12)
// CHECK-NEXT: b5(v13, v14):
// CHECK-NEXT: v15 = TypeTest v13 testedType=object
// CHECK-NEXT: Branch v15 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: v17 = PropGet v16 key="eval"
// CHECK-NEXT: Jump -> next b8(v17)
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="eval" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8(v21)
// CHECK-NEXT: b8(v22):
// CHECK-NEXT: v23 = String string="typeof this + local"
// CHECK-NEXT: v24 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v25 = StrictEq v22, v24
// CHECK-NEXT: Branch v25 -> taken b9(), notTaken b10(| 0)
// CHECK-NEXT: b9():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: v27 = DirectEval v23, v1, v26, v7, v3, v0, v2 evalScope=e3
// CHECK-NEXT: Jump -> next b11(v27)
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: v29 = Call v28, v14, v23 calleeName="eval"
// CHECK-NEXT: Jump -> next b11(v29)
// CHECK-NEXT: b11(v30):
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
