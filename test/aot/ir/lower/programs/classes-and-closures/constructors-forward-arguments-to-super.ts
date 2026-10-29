// RUN: lower
// OPTIONS: builtin-modules

// @ts-nocheck
const lines = [];
const show = value => JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function " + v.name : v instanceof Map ? ["Map", ...v] : v instanceof Error ? ["Error", v.message] : v));
function attempt(name, run) { let said; try { said = show(run()); } catch (e) { said = "THROWS " + e.constructor.name + (/^(the parent is n|extends null)/.test(name) ? "" : ": " + e.message); } lines.push(name + " | " + said); }
const noted = [];
function Plain(a, b, c) { this.got = [a, b, c, arguments.length]; this.target = new.target && new.target.name; }
Plain.prototype.kind = "plain";
class Base { constructor(a, b, c) { this.got = [a, b, c, arguments.length]; this.target = new.target.name; } }
class BaseWithRest { constructor(...all) { this.got = all; this.target = new.target.name; } }
class BaseWithDefaults { constructor(a = "da", b = "db") { this.got = [a, b, arguments.length]; } }
function Returning(a) { return { returned: a, count: arguments.length }; }
function ReturningPrimitive(a) { this.a = a; return 5; }
const Bound = Plain.bind(null, "bound"); Bound.prototype = Plain.prototype;
const Proxied = new Proxy(Plain, { construct(t, list, nt) { noted.push("construct " + list.length); return Reflect.construct(t, list, nt); } });
const parents = { Plain, Base, BaseWithRest, BaseWithDefaults, Returning, ReturningPrimitive, Bound, Proxied, Array, Map: class extends Map { constructor(x) { super(x); } }, Error, Object, Promise: class { constructor(...x) { this.x = x; } } };
const forms = {
    byArguments: P => class ByArguments extends P { constructor() { super(...arguments); } },
    withStores: P => class WithStores extends P { constructor() { super(...arguments); this.state = { error: 0 }; this.reset = () => { this.state = { error: 1 }; }; } },
    withParameters: P => class WithParameters extends P { constructor(a, b) { super(...arguments); this.sum = [a, b]; } },
    parameterAssigned: P => class ParameterAssigned extends P { constructor(a) { a = "assigned"; super(...arguments); this.a = a; } },
    withDefault: P => class WithDefault extends P { constructor(a = "default") { super(...arguments); this.a = a; } },
    kept: P => class Kept extends P { constructor() { super(...arguments); this.count = arguments.length; this.zero = arguments[0]; } },
    held: P => class Held extends P { constructor() { const held = arguments; super(...held); this.held = [...held]; } },
    written: P => class Written extends P { constructor() { arguments[0] = "written"; super(...arguments); } },
    cut: P => class Cut extends P { constructor() { arguments.length = 1; super(...arguments); } },
    ownIterator: P => class OwnIterator extends P { constructor() { arguments[Symbol.iterator] = function* () { yield "iterated"; }; super(...arguments); } },
    noIterator: P => class NoIterator extends P { constructor() { delete arguments[Symbol.iterator]; super(...arguments); } },
    extraBehind: P => class ExtraBehind extends P { constructor() { super(...arguments, "extra"); } },
    extraAhead: P => class ExtraAhead extends P { constructor() { super("ahead", ...arguments); } },
    twice: P => class Twice extends P { constructor() { super(...arguments, ...arguments); } },
    inTry: P => class InTry extends P { constructor() { try { super(...arguments); } catch (e) { noted.push("caught " + e.constructor.name); super(); } } },
    inArrow: P => class InArrow extends P { constructor() { const go = () => super(...arguments); go(); } },
    conditional: P => class Conditional extends P { constructor() { if (arguments.length > 1) super(...arguments); else super("few"); } },
    withFields: P => class WithFields extends P { field = "f"; constructor() { super(...arguments); this.late = this.field; } },
    thisAhead: P => class ThisAhead extends P { constructor() { this.early = 1; super(...arguments); } },
    superTwice: P => class SuperTwice extends P { constructor() { super(...arguments); super(...arguments); } },
    applied: P => class Applied extends P { constructor() { super(...Array.prototype.slice.call(arguments)); } },
    deep: P => { class One extends P { constructor() { super(...arguments); this.one = 1; } } class Two extends One { constructor(...args) { super(...args); this.two = 2; } } return class Three extends Two { constructor() { super(...arguments); this.three = 3; } }; },
};
const lists = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5], [undefined, null], [[1, 2]], Array.from({ length: 12 }, (_, i) => i)];
function make(C, list) { switch (list.length) { case 0: return new C(); case 1: return new C(list[0]); case 2: return new C(list[0], list[1]); case 3: return new C(list[0], list[1], list[2]); default: return new C(...list); } }
function look(o) { return [Object.getPrototypeOf(o)?.constructor?.name, { ...o }, Array.isArray(o) ? [...o] : o instanceof Map ? [...o] : o instanceof Error ? o.message : 0]; }
for (const [parent, P] of Object.entries(parents))
    for (const [form, build] of Object.entries(forms)) {
        const C = build(P);
        for (const list of lists)
            attempt(parent + " | " + form + " | " + list.length, () => { noted.length = 0; const made = look(make(C, parent === "Map" ? [] : list)); return noted.length ? [made, noted.slice()] : made; });
    }
attempt("another new.target", () => { const C = forms.withStores(Base); class Other { } const o = Reflect.construct(C, [1, 2], Other); return [o.target, Object.getPrototypeOf(o) === Other.prototype, o.got, o.state]; });
attempt("the parent is changed", () => { const C = forms.byArguments(Base); const before = new C(1).got; Object.setPrototypeOf(C, BaseWithRest); return [before, new C(1, 2).got]; });
attempt("the parent is no constructor", () => { const C = forms.byArguments(Base); Object.setPrototypeOf(C, () => 0); return new C(1); });
attempt("the parent is null", () => { const C = forms.byArguments(Base); Object.setPrototypeOf(C, null); return new C(1); });
attempt("extends null", () => new (class extends null { constructor() { super(...arguments); } })(1));
attempt("called without new", () => forms.byArguments(Base)(1));
attempt("many at one site", () => { let sum = 0; const classes = [forms.byArguments(Plain), forms.withStores(Plain), forms.kept(Plain), forms.withParameters(Plain)]; for (let i = 0; i < 400; i++) sum += new classes[i & 3](i, 1).got[0]; return sum; });
attempt("the parent throws", () => new (forms.withStores(class { constructor(a) { throw new RangeError("from the parent " + a); } }))(7));
console.log(lines.join("\n"));

// GENERATED: Returning construct Applied go
// CHECK-LABEL: function {{*}}name="Returning"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v0, v2, v1
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = NewObject -, v1 layout=[[L_1]] fields=[1]
// CHECK-NEXT: PropDefine v6, v5 key="count"
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[f_3]] flags=[IsExpected]}, {type=undefined|null|Array flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_3]], v1: undefined|null|Array, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="noted"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="construct "
// CHECK-NEXT: v8 = PropGet v1 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Call v6, v4, v10 calleeKey="push" calleeName="noted.push"
// CHECK-NEXT: v12 = Builtin builtin=Reflect
// CHECK-NEXT: v13 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v14 = Call v13, v12, v0, v1, v2 calleeName="Reflect.construct" [isDoneInPlace]
// CHECK-NEXT: ReturnCall v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Applied"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: v5 = Absent
// CHECK-NEXT: v6 = GetSuperBase v0
// CHECK-NEXT: v7 = NewArray contents=anything
// CHECK-NEXT: v8 = Builtin builtin=ArrayPrototypeSlice
// CHECK-NEXT: v9 = PropGet v8 key="call"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, v8, v4 calleeKey="call" calleeName="Array.prototype.slice.call"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread v7, v12
// CHECK-NEXT: v14 = SuperConstructList v6, v1, v7 layout=[[L_8]]
// CHECK-NEXT: v15 = Convert v14 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v16 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v16 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v17):
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v20):
// CHECK-NEXT: Jump -> next b8(v20)
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v23):
// CHECK-NEXT: v24 = TypeTest v15 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v25) frequency=Unlikely:
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b7(v27):
// CHECK-NEXT: Jump -> next b8(v27)
// CHECK-NEXT: b8(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b9(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="Applied"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b10(v31) frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="go"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_9]] flags=[IsFromCompiler]}, {type=anything}, {type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: env [[L_9]], v1: anything, v2: function, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetSuperBase v2
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v5, v3
// CHECK-NEXT: v7 = SuperConstructList v4, v1, v5 layout=[[L_11]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v10 = TypeTest v9 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: PutEnvironmentField v0, v8 layout=[[L_9]]
// CHECK-NEXT: Return v8
// CHECK-NEXT: b3(v13) frequency=Unlikely:
// CHECK-NEXT: v14 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v14
// CHECK-NEXT: }
