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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_2]]
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_5]]
// CHECK-NEXT: v7 = NewClosure function=[[f_6]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_8]]
// CHECK-NEXT: v10 = String string="an argument with an effect"
// CHECK-NEXT: v11 = Call v5, -, v10 calleeName="effect"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v8, -, v12 calleeName="make"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="not marked inside marked"
// CHECK-NEXT: v16 = Call v8, -, v15 calleeName="make"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v8, -, v17 calleeName="make"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v20 = String string="an export of the entry point"
// CHECK-NEXT: v21 = Call v8, -, v20 calleeName="make"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v22 variable=[[g_10]]
// CHECK-NEXT: v24 = String string="used"
// CHECK-NEXT: v25 = Call v8, -, v24 calleeName="make"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v27 = String string="spread argument"
// CHECK-NEXT: v28 = NewArray v27 contents=anything
// CHECK-NEXT: v29 = String string="in a spread"
// CHECK-NEXT: v30 = Call v5, -, v29 calleeName="effect"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: AppendElement v28, v31
// CHECK-NEXT: v33 = CallList v8, -, v28 calleeName="make"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v35 = Builtin builtin=GlobalThis
// CHECK-NEXT: v36 = PropGet v35 key="console" [isFreeName]
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v37 key="log"
// CHECK-NEXT: v39 = Convert v38 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v26 key="name"
// CHECK-NEXT: v41 = Call v39, v37, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v42 = Builtin builtin=GlobalThis
// CHECK-NEXT: v43 = PropGet v42 key="console" [isFreeName]
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v45 = PropGet v44 key="log"
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v2 key="join"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v49 = String string="\n"
// CHECK-NEXT: v50 = Call v48, v2, v49 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v52 = Call v46, v44, v51 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v53 = Undefined
// CHECK-NEXT: Return v53
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="effect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_9]] flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="make "
// CHECK-NEXT: v6 = Add v5, v0
// CHECK-NEXT: v7 = Call v4, v2, v6 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v8 = NewObject -, v0 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
