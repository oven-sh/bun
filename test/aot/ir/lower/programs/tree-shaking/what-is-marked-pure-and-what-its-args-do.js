// RUN: lower
// OPTIONS: builtin-modules

// A mark before a call or a `new` lets it go when its result is not used. What the arguments do stays or goes with the whole call, as the bundler has it. The calls stand in constants, in exports, in statements, in arguments of other marked calls, in class fields and after extends.
const log = [];
const effect = name => { log.push(name); return name; };
const make = name => { log.push("make " + name); return { name }; };
class Made { constructor(name) { log.push("new Made " + name); } }

const a = /* @__PURE__ */ make("a constant nothing reads");
const b = /* @__PURE__ */ new Made("a constant nothing reads");
const c = /* @__PURE__ */ make(effect("an argument with an effect"));
const d = /* @__PURE__ */ make(/* @__PURE__ */ make("marked inside marked"));
const e = /* @__PURE__ */ make(make("not marked inside marked"));
const f = [/* @__PURE__ */ make("in an array nothing reads")];
const g = { key: /* @__PURE__ */ make("in an object nothing reads") };
const h = () => /* @__PURE__ */ make("in a function nobody calls");
export const i = /* @__PURE__ */ make("an export of the entry point");
class J { static field = /* @__PURE__ */ make("a static field of a class nothing names"); }
class K extends (/* @__PURE__ */ make("after extends"), Object) {}
const l = /* @__PURE__ */ make("used");
const m = /* @__PURE__ */ (() => effect("a marked function called on the spot"))();
const o = /* @__PURE__ */ make?.("an optional call");
const p = /* @__PURE__ */ make("spread argument", ...[effect("in a spread")]);
const q = true ? /* @__PURE__ */ make("an arm") : 0;
/* @__PURE__ */ make("a statement");
/* @__PURE__ */ new Made("a statement");
void /* @__PURE__ */ make("under void");

console.log(l.name);
console.log(log.join("\n"));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_2]]
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_4]]
// CHECK-NEXT: v4 = NewClosure function=[[f_5]]
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_6]]
// CHECK-NEXT: v6 = String string="an argument with an effect"
// CHECK-NEXT: v7 = Call v2, -, v6 calleeName="effect"
// CHECK-NEXT: v8 = Call v4, -, v7 calleeName="make"
// CHECK-NEXT: v9 = String string="not marked inside marked"
// CHECK-NEXT: v10 = Call v4, -, v9 calleeName="make"
// CHECK-NEXT: v11 = Call v4, -, v10 calleeName="make"
// CHECK-NEXT: v12 = String string="an export of the entry point"
// CHECK-NEXT: v13 = Call v4, -, v12 calleeName="make"
// CHECK-NEXT: PutModuleVariable v13 variable=[[g_7]]
// CHECK-NEXT: v15 = String string="used"
// CHECK-NEXT: v16 = Call v4, -, v15 calleeName="make"
// CHECK-NEXT: v17 = String string="spread argument"
// CHECK-NEXT: v18 = NewArray v17 contents=anything
// CHECK-NEXT: v19 = String string="in a spread"
// CHECK-NEXT: v20 = Call v2, -, v19 calleeName="effect"
// CHECK-NEXT: AppendElement v18, v20
// CHECK-NEXT: v22 = CallList v4, -, v18 calleeName="make"
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v16 key="name"
// CHECK-NEXT: v29 = Call v27, v25, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v0 key="join"
// CHECK-NEXT: v36 = String string="\n"
// CHECK-NEXT: v37 = Call v35, v0, v36 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v38 = Call v34, v32, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="effect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_8]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_8]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="make "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v7 = NewObject -, v0 layout=[[L_8]] fields=[0]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
