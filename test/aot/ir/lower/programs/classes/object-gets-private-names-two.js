// RUN: lower
// OPTIONS: builtin-modules

// A function makes a class with private names and is called more than once. One object passes through two of the classes, so it holds the private names of both.
const lines = [];
let made = 0;
class Plain { plain = 1; }
function mix(Base) {
  const id = ++made;
  return class extends Base {
    #hidden = id;
    #method() { return "method " + id; }
    reads() { return this.#hidden; }
    calls() { return this.#method(); }
    below() { return typeof super.reads === "function" ? super.reads() + " " + super.calls() : "nothing"; }
    bump() { this.#hidden += 10; return this; }
    static has(object) { return #hidden in object; }
  };
}
const Once = mix(Plain), Twice = mix(Once), Thrice = mix(Twice);
for (const Class of [Once, Twice, Thrice]) {
  const object = new Class();
  lines.push(object.reads(), object.calls(), object.below(), object.bump().reads(), object.below(), Once.has(object), Twice.has(object), Thrice.has(object));
  lines.push(Object.keys(object).join(), JSON.stringify(object), Reflect.ownKeys(object).length, JSON.stringify({ ...object }), Thrice.has({ ...object }), "hidden" in object, object.hidden);
}
console.log(lines.join(" "));

lines.length = 0;
class Identity { constructor(object) { if (object) return object; } }
function stamper() {
  const id = ++made;
  return class Stamper extends Identity { #stamp = id; own = id; static has(object) { return #stamp in object; } static read(object) { return object.#stamp; } };
}
const First = stamper(), Second = stamper();
const stamped = new First();
lines.push(new Second(stamped) === stamped, First.read(stamped), Second.read(stamped), stamped.own, Object.keys(stamped).join(), JSON.stringify(stamped));
try { new Second(stamped); lines.push("twice"); } catch (error) { lines.push(error.constructor.name); }
try { new First(stamped); lines.push("twice"); } catch (error) { lines.push(error.constructor.name); }
lines.push(First.has(new Second()), Second.has(new First()));
console.log(lines.join(" "));

function local() { const object = new Twice(); return object.reads() * 100 + object.bump().reads() + object.plain; }
let sum = 0;
for (let turn = 0; turn < 20000; turn++) sum += local();
console.log(sum);

// GENERATED: stamper Plain below bump Stamper
// CHECK-LABEL: function {{*}}name="stamper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="made"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="made"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_2]]
// CHECK-NEXT: v7 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="Identity"
// CHECK-NEXT: v10 = ResolveHeritage v9
// CHECK-NEXT: v11 = NewClassToken layout=[[L_4]]
// CHECK-NEXT: v12 = NewClosure v7, v11 function=[[f_5]]
// CHECK-NEXT: v13 = NewClass v12, v9, v10 layout=[[L_4]]
// CHECK-NEXT: v14 = NewClosure v11 function=[[f_6]]
// CHECK-NEXT: DefineMethod v13, v14 layout=[[L_4]] side=Static key="has"
// CHECK-NEXT: v16 = NewClosure v11 function=[[f_7]]
// CHECK-NEXT: DefineMethod v13, v16 layout=[[L_4]] side=Static index=1 key="read"
// CHECK-NEXT: v18 = FinishClass v13 layout=[[L_4]]
// CHECK-NEXT: v19 = Convert v18 declared={type=[[f_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v20 = Convert v18 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_10]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="below"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}] thisType={type=[[L_11]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: function, v1: [[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v1 key="reads"
// CHECK-NEXT: v4 = TypeTest v3 testedType=function
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v7 = SuperGet v6, v1 key="reads"
// CHECK-NEXT: v8 = Call v7, v1 calleeName="super.reads"
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v12 = SuperGet v11, v1 key="calls"
// CHECK-NEXT: v13 = Call v12, v1 calleeName="super.calls"
// CHECK-NEXT: v14 = Add v10, v13
// CHECK-NEXT: Jump -> next b6(v14)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v16 = String string="nothing"
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=[[L_11]] flags=[IsExpected]} results=[{type=undefined|null|[[L_11]] flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: [[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PrivateGet v2, v0 layout=[[L_11]] field=1
// CHECK-NEXT: v4 = Integer integer=10
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PrivateSet v2, v0, v6 layout=[[L_11]] field=1
// CHECK-NEXT: v8 = Convert v1 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Stamper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] captures=[{type=number flags=[IsExpected]}, {type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: number, v1: classtoken, v2: function, v3: anything, v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetSuperBase v2
// CHECK-NEXT: v6 = SuperConstructList v5, v3, v4 layout=[[L_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = CallDirect v0, v1, v7 function=[[f_14]]
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
