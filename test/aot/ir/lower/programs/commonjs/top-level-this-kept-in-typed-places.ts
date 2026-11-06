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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keeper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy, IsChecked] captures=[{type=env [[L_6]] flags=[IsFromCompiler]}, {type=undefined|null|[[L_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array<undefined> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_4]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: env [[L_6]], v1: undefined|null|[[L_7]], v2: undefined|null|Array<undefined>, v3: undefined|null|[[L_4]], v4: anything, v5: object, v6: object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = NewObject layout=[[L_12]]
// CHECK-NEXT: v8 = Null
// CHECK-NEXT: SetLiteralPrototype v7, v8
// CHECK-NEXT: v10 = FinishObject v7
// CHECK-NEXT: v11 = ScopeHasBinding v10 key="eval"
// CHECK-NEXT: Branch v11 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Jump -> next b6(v10, v12)
// CHECK-NEXT: b3():
// CHECK-NEXT: v13 = ScopeHasBinding v6 key="eval"
// CHECK-NEXT: Branch v13 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Jump -> next b6(v6, v14)
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Jump -> next b6(v15, v15)
// CHECK-NEXT: b6(v16, v17):
// CHECK-NEXT: v18 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v18 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v19):
// CHECK-NEXT: v20 = PropGet v19 key="eval"
// CHECK-NEXT: Jump -> next b9(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="eval" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v24)
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: v26 = String string="typeof this + local"
// CHECK-NEXT: v27 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v28 = StrictEq v25, v27
// CHECK-NEXT: Branch v28 -> taken b10(), notTaken b11(| 0)
// CHECK-NEXT: b10():
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: v30 = DirectEval v26, v4, v29, v0, v1, v2, v3, v10, v6, v5 evalScope=e3
// CHECK-NEXT: Jump -> next b12(v30)
// CHECK-NEXT: b11(v31):
// CHECK-NEXT: v32 = Call v31, v17, v26 calleeName="eval"
// CHECK-NEXT: Jump -> next b12(v32)
// CHECK-NEXT: b12(v33):
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
