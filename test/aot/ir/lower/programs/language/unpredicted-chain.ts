// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// The predicted callee follows the prototype chain between constructor functions, through names of type `any`, and a wrong prediction does no harm.
import middle from "./req/un_chain_middle";
declare const console: any;
const { Middle, helper } = middle;
function Top(this: any, options?: any) { this.state = { n: 0 }; Middle.call(this, options); }
Object.setPrototypeOf(Top.prototype, Middle.prototype);
Object.setPrototypeOf(Top, Middle);
Top.prototype.push = function (this: any, chunk: any) { return push(this, this.state, chunk); };
function push(stream: any, state: any, chunk: any) { return deliver(stream, state, chunk); }
function deliver(stream: any, state: any, chunk: any) { state.n++; return stream.emit("data", chunk); }
let n = 0;
const listen = function (this: any, v: number) { n += v };
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f()), n) } catch (e) { console.log(label + ":", (e as Error).constructor.name, n) } }
function make() { const t = new (Top as any)(); t.on("data", listen); return t }
attempt("inherited two levels up", () => make().emit("data", 1));
attempt("handed down two calls", () => make().push(2));
attempt("the nearest wins", () => [make().name(), new Middle().name()].join());
attempt("added with addListener", () => { const t = new (Top as any)(); t.addListener("data", listen); return t.push(3) });
attempt("added through a helper", () => { const t = new (Top as any)(); helper(t, "data", listen); return t.push(4) });
attempt("instanceof", () => [make() instanceof Middle, make() instanceof (Top as any), Object.getPrototypeOf(Top) === Middle].join());
class Sub extends (Top as any) { ping() { return this.emit("data", 5) } }
class SubOverriding extends (Top as any) { emit() { return "overridden" } ping() { return (this as any).emit("data", 5) } }
attempt("a class on top", () => { const s: any = new Sub(); s.on("data", listen); return [s.ping(), s.push(6)].join() });
attempt("a class that overrides", () => { const s: any = new SubOverriding(); s.on("data", listen); return [s.ping(), s.push(6)].join() });
// The inheriting object gets its own function afterwards.
const before = make();
Top.prototype.emit = function () { return "top's own" };
attempt("the heir shadows", () => [before.emit("data", 1), before.push(1), make().push(1), new Middle().emit("data", 1)].join());
delete Top.prototype.emit;
attempt("and does not any more", () => before.push(7));
// The prototype chain is cut and reattached elsewhere.
const Other: any = function (this: any) {}; Other.prototype.emit = function () { return "other" }; Other.prototype.on = function () { return this };
Object.setPrototypeOf(Top.prototype, Other.prototype);
attempt("another base", () => [before.emit("data", 1), before.push(1), make().push(1)].join());
Object.setPrototypeOf(Top.prototype, null);
attempt("no base", () => before.push(1));
Object.setPrototypeOf(Top.prototype, Middle.prototype);
attempt("the first base again", () => before.push(8));
// `on` is stored again: `addListener` stays.
Object.getPrototypeOf(Middle.prototype).on = function () { return "no listener" };
attempt("the second name is replaced", () => { const t = new (Top as any)(); return [t.on("data", listen), t.push(9), t.addListener("data", listen) === t, t.push(9)].join() });
export {};

// FILE: req/un_chain_base.ts
function Base(this: any) { this._events = Object.create(null); this.count = 0; }
const BasePrototype: any = (Base.prototype = {} as any);
BasePrototype.constructor = Base;
BasePrototype.emit = function emit(this: any, type: any, a: any) { const h = this._events[type]; if (h === undefined) return false; h.call(this, a); return true; };
BasePrototype.addListener = function addListener(this: any, type: any, fn: any) { add(this, type, fn); return this; };
BasePrototype.on = BasePrototype.addListener;
BasePrototype.name = function name() { return "base"; };
function add(target: any, type: any, fn: any) { var events = target._events; if (!events) events = target._events = Object.create(null); events[type] = fn; target.count++; }
export default Base as any;

// FILE: req/un_chain_middle.ts
import base from "./un_chain_base";
const Base = base as any;
function Middle(this: any, options?: any) { Base.call(this, options); this.middle = true; }
Object.setPrototypeOf(Middle.prototype, Base.prototype);
Object.setPrototypeOf(Middle, Base);
Middle.prototype.name = function name() { return "middle"; };
function helper(e: any, type: any, fn: any) { return e.on(type, fn); }
export default { Middle, helper } as unknown as { Middle: any; helper: any };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: Top deliver attempt Sub emit
// CHECK-LABEL: function {{*}}name="Top"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_1]] site=[[w_2]]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Data data=[[d_4]]
// CHECK-NEXT: PropSet v2, v3 key="state"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="Middle"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="call"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v9, v7, v0, v1 calleeKey="call" calleeName="Middle.call"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="deliver"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="n"
// CHECK-NEXT: v5 = Increment v4
// CHECK-NEXT: PropSet v3, v5 key="n"
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="emit"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="data"
// CHECK-NEXT: v11 = Call v9, v7, v10, v2 calleeKey="emit" calleeName="stream.emit"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=":"
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v1 calleeName="f"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="n"
// CHECK-NEXT: v15 = Call v6, v4, v8, v12, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string=":"
// CHECK-NEXT: v23 = Add v0, v22
// CHECK-NEXT: v24 = Convert v16 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v25 = PropGet v24 key="constructor"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|function site=[[w_13]]} illTypedCause=Assertion
// CHECK-NEXT: v27 = PropGet v26 key="name"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_13]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="n"
// CHECK-NEXT: v31 = Call v21, v19, v23, v28, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Sub"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="emit"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="overridden"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
