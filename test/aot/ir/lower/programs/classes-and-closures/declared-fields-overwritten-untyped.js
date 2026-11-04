// RUN: lower
// OPTIONS: builtin-modules

// A declared field is defined as undefined before the constructor's body runs. Where the body always stores again nobody sees that value, and every way to see it still works.
const seed = parseInt(process.argv[2] ?? "3", 10);
const seen = [];
function note(value) { seen.push(value === undefined ? "undefined" : value); }

class Filled {
    count; ratio; on; label; next; parent; list;
    constructor(n) {
        this.list = [n]; this.parent = null; this.next = this; this.label = "n" + n; this.on = n > 1; this.ratio = n + 0.5; this.count = n | 0;
    }
}
const filled = new Filled(seed);
note(Object.keys(filled).join());
note(JSON.stringify({ ...filled, next: 0 }));
note(filled.next.next.count ^ 5);
note(filled.count + filled.ratio);

class FilledOnOnePath { count; constructor(n) { if (n > 100) this.count = n; } }
note(new FilledOnOnePath(seed).count);
note(new FilledOnOnePath(seed + 200).count);
note("count" in new FilledOnOnePath(seed));

class NeverFilled { count; }
note(new NeverFilled().count);
note(Object.keys(new NeverFilled()).join());

class ReadsFirst { count; before; constructor(n) { this.before = this.count; this.count = n; } }
note(new ReadsFirst(seed).before);

class MethodReadsFirst { count; constructor(n) { this.look(); this.count = n; } look() { note(this.count); } }
note(new MethodReadsFirst(seed).count);

let registered;
function lookAtRegistered() { note(registered.count); }
class LeaksFirst { count; constructor(n) { registered = this; lookAtRegistered(); this.count = n; } }
note(new LeaksFirst(seed).count);

class EnumeratesFirst { count; label; constructor(n) { note(JSON.stringify(this)); note(Object.keys(this).join()); this.label = "l"; this.count = n; } }
note(Object.keys(new EnumeratesFirst(seed)).join());

class TestsFirst { count; constructor(n) { note("count" in this); note(Object.hasOwn(this, "count")); this.count = n; } }
note(new TestsFirst(seed).count);

class FilledByMethod { count; constructor(n) { this.reset(n); } reset(n) { this.count = n * 2; } }
note(new FilledByMethod(seed).count);

class Parent { constructor() { this.start(); } start() { } }
class ReadWhileParentRuns extends Parent { count; constructor(n) { super(); this.count = n; } start() { note(this.count); note("count" in this); } }
note(new ReadWhileParentRuns(seed).count);

class StoredWhileParentRuns extends Parent { count; constructor() { super(); } start() { this.count = 7; } }
note(new StoredWhileParentRuns().count);

let lastBuilt;
class Registering { constructor() { lastBuilt = this; } }
function lookAtLastBuilt() { note(lastBuilt.count); }
class ChildOfRegistering extends Registering { count; constructor(n) { super(); lookAtLastBuilt(); this.count = n; } }
note(new ChildOfRegistering(seed).count);

class Shape { sides; kind; constructor() { this.sides = 3; } }
class Square extends Shape { constructor() { super(); this.sides = 4; this.kind = "square"; } }
note(new Shape().kind); note(new Shape().sides); note(new Square().kind); note(new Square().sides); note(Object.keys(new Square()).join());

class InitializedThenOverwritten { label = 0; total = 1; constructor(n) { this.label = "s" + n; this.total = this.total + n; } }
note(new InitializedThenOverwritten(seed).label); note(new InitializedThenOverwritten(seed).total);

class ThrowsBeforeStore {
    count;
    constructor(fail) { try { if (fail) throw new Error("no"); this.count = 1; } catch { note("caught"); } }
}
note(new ThrowsBeforeStore(true).count); note(new ThrowsBeforeStore(false).count);

class Private {
    #count; #label = "a";
    constructor(n) { this.#count = n | 0; }
    get count() { return this.#count; }
    get label() { return this.#label; }
    static has(value) { return #count in value; }
}
note(new Private(seed).count ^ 1); note(new Private(seed).label); note(Private.has(new Private(seed))); note(Private.has({}));

class PrivateReadFirst { #count; before; constructor(n) { this.before = this.#count; this.#count = n; } get count() { return this.#count; } }
note(new PrivateReadFirst(seed).before); note(new PrivateReadFirst(seed).count);

class WithSetterAbove { set count(value) { note("setter " + value); } }
class HidesSetter extends WithSetterAbove { count; constructor(n) { super(); this.count = n; } }
note(Object.getOwnPropertyDescriptor(new HidesSetter(seed), "count").value);

class Frozen { count; constructor(n) { this.count = n; Object.freeze(this); } }
note(new Frozen(seed).count); note(Object.isFrozen(new Frozen(seed)));

class ClosureSeesIt { count; read = () => this.count; before; constructor(n) { this.before = this.read(); this.count = n; } }
note(new ClosureSeesIt(seed).before); note(new ClosureSeesIt(seed).read());

class ReturnsEarly { count; constructor(n) { if (n < 100) return; this.count = n; } }
note(new ReturnsEarly(seed).count);

console.log(seen.join(" | "));

// GENERATED: reset Private label has StoredWhileParentRuns
// CHECK-LABEL: function {{*}}name="reset"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: PropSet v2, v5 key="count"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Private"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: v6 = Convert v4 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = BitOr v1, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: PrivateSet v6, v10, v9 layout=[[L_3]] field=1
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = TypeTest v12 testedType=object
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_3]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = PrivateGet v1, v2 layout=[[L_3]] field=2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_3]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="StoredWhileParentRuns"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b8(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = TypeTest v12 testedType=undefined
// CHECK-NEXT: Branch v13 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v15 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v16) frequency=Unlikely:
// CHECK-NEXT: v17 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v17
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8(v18)
// CHECK-NEXT: b8(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: b9(v20) frequency=Unlikely:
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=DerivedConstructorResult name="StoredWhileParentRuns"
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b10(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v23
// CHECK-NEXT: }
