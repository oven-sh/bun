// RUN: lower
// OPTIONS: builtin-modules

// names read through a native constructor are cached: whatever can change behind the cache
const out = [];
function say(...a) { out.push(a.map(String).join(" ")); }
function attempt(name, f) { try { say(name, f()); } catch (e) { say(name, "threw", e.constructor.name); } }
class Failure extends Error { constructor(m) { super(m); this.name = "Failure"; } }
class Deep extends Failure {}
class Other extends TypeError {}
class Table extends Map {}
class List extends Array {}
class Later extends Promise {}
function kind(e) { if (e instanceof Deep) return "deep"; if (e instanceof Failure) return "failure"; if (e instanceof Other) return "other"; if (e instanceof Error) return "error"; return "none"; }
function caught(f) { try { f(); } catch (e) { return kind(e); } return "nothing"; }
const throwers = [() => { throw new Deep("d"); }, () => { throw new Failure("f"); }, () => { throw new Other("o"); }, () => { throw new Error("e"); }, () => { throw 5; }, () => { throw { __proto__: Failure.prototype }; }, () => { throw null; }];
function round() { return throwers.map(caught).join(); }
function warm() { let r; for (let i = 0; i < 200; i++) r = round(); return r; }
say("warm", warm());
function limit(C) { return C.stackTraceLimit; }
function read(C, k) { return C[k]; }
function missing(C) { return C.notThere; }
for (let i = 0; i < 300; i++) { limit(Failure); limit(Deep); missing(Failure); missing(Table); missing(List); missing(Later); }
say("limit", limit(Failure), limit(Deep), limit(Other), missing(Failure), missing(Table));
Error.stackTraceLimit = 3;
say("limit written on Error", limit(Failure), limit(Deep), limit(Other), limit(Error));
attempt("a new name on Error", () => { Error.notThere = "now there"; return [missing(Failure), missing(Deep), missing(Other), missing(Table)].join(); });
attempt("a new name on Map", () => { Map.notThere = "on Map"; return [missing(Table), missing(List)].join(); });
attempt("deleted from Error", () => { delete Error.notThere; return [missing(Failure), missing(Deep)].join(); });
attempt("deleted from Function.prototype", () => { delete Map.notThere; return [missing(Failure), missing(Table), missing(List)].join(); });
Failure.stackTraceLimit = 77;
say("own limit", limit(Failure), limit(Deep), limit(Other), limit(Error));
delete Failure.stackTraceLimit;
say("own limit gone", limit(Failure), limit(Deep));
attempt("limit deleted from Error", () => { delete Error.stackTraceLimit; return [limit(Failure), limit(Error)].join(); });
Error.stackTraceLimit = 10;
say("limit back", limit(Failure), limit(Deep));
// statics
function from(C, v) { return C.from(v); }
function of(C) { return C.of(1, 2); }
for (let i = 0; i < 300; i++) { from(List, [1]); of(List); }
say("from", from(List, [1, 2]) instanceof List, from(List, [1, 2]).length, of(List).constructor === List);
attempt("List.from own", () => { List.from = () => "own"; const r = from(List, [1]); delete List.from; return r + " " + from(List, [1]).length; });
function resolve(C, v) { return C.resolve(v); }
for (let i = 0; i < 300; i++) resolve(Later, 1);
say("resolve", resolve(Later, 1) instanceof Later);
function species(C) { return C[Symbol.species]; }
for (let i = 0; i < 300; i++) { species(List); species(Table); species(Later); }
say("species", species(List) === List, species(Table) === Table, species(Later) === Later, new List(1, 2, 3).map(x => x) instanceof List);
Object.defineProperty(List, Symbol.species, { get() { return Array; }, configurable: true });
say("species own", species(List) === Array, new List(1, 2, 3).map(x => x) instanceof List);
delete List[Symbol.species];
say("species back", species(List) === List, new List(1, 2, 3).map(x => x) instanceof List);
// Symbol.hasInstance
Object.defineProperty(Failure, Symbol.hasInstance, { value(v) { return v === 5; }, configurable: true });
say("hasInstance on Failure", round());
delete Failure[Symbol.hasInstance];
say("and gone", round());
say("and gone", round(), warm());
Object.defineProperty(Deep, Symbol.hasInstance, { get() { say("getter ran"); return undefined; }, configurable: true });
attempt("a getter that gives undefined", () => caught(throwers[0]));
delete Deep[Symbol.hasInstance];
// the constructors' parents move
Object.setPrototypeOf(Deep, Other);
say("parent of the constructor moved", limit(Deep), round(), Deep.name);
Object.setPrototypeOf(Deep, { [Symbol.hasInstance]() { return true; }, stackTraceLimit: "from an object" });
attempt("to a plain object", () => limit(Deep) + " " + round());
Object.setPrototypeOf(Deep, null);
attempt("to null", () => limit(Deep) + " " + round());
Object.setPrototypeOf(Deep, Failure);
say("back", limit(Deep), round());
// the prototypes move
Object.setPrototypeOf(Deep.prototype, Other.prototype);
say("parent of the prototype moved", round());
Object.setPrototypeOf(Deep.prototype, Failure.prototype);
say("back", round());
Object.defineProperty(Failure, "prototype", { value: Failure.prototype, writable: false });
attempt("function with prototype replaced", () => { function F() {} const x = new F(); let r = ""; for (let i = 0; i < 200; i++) r = x instanceof F; F.prototype = {}; return r + " " + (x instanceof F); });
attempt("bound", () => { const B = Failure.bind(null); let r; for (let i = 0; i < 200; i++) r = new Deep("x") instanceof B; return r; });
attempt("not callable", () => ({}) instanceof {});
attempt("prototype is not an object", () => { function F() {} F.prototype = 3; return ({}) instanceof F; });
say("names", Failure.name, Failure.length, Deep.length, Table.name, Object.getPrototypeOf(Failure) === Error, Failure.captureStackTrace === Error.captureStackTrace, typeof Failure.captureStackTrace);
attempt("isError", () => [Error.isError && Failure.isError(new Deep("x")), Table.groupBy === Map.groupBy, List.isArray(new List())].join());
console.log(out.join("\n"));

// GENERATED: round read species Failure Deep [Symbol.hasInstance]
// CHECK-LABEL: function {{*}}name="round"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="throwers"
// CHECK-NEXT: v2 = PropGet v1 key="map"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="map" calleeName="throwers.map"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|"deep"|"error"|"failure"|"none"|"nothing"|"other"> flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="join"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v8, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="read"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="species"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key=@@species
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Failure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v9 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v10) frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="Failure"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v13, v15 key="name"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v18 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: Jump -> next b10(v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = TypeTest v20 testedType=undefined
// CHECK-NEXT: Branch v21 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = TypeTest v12 testedType=absent
// CHECK-NEXT: Branch v23 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v24) frequency=Unlikely:
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v25
// CHECK-NEXT: b9(v26):
// CHECK-NEXT: Jump -> next b10(v26)
// CHECK-NEXT: b10(v27):
// CHECK-NEXT: Return v27
// CHECK-NEXT: b11(v28) frequency=Unlikely:
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=DerivedConstructorResult name="Failure"
// CHECK-NEXT: Throw v29
// CHECK-NEXT: b12(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Deep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.hasInstance]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
