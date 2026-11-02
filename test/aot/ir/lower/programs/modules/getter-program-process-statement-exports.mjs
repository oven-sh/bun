// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A getter that the program put on process runs where a statement exports its name from node process.
const holder = process;
const log = [];
globalThis.note = text => log.push(text);
const show = what => { console.log(what + ":", log.join(" ") || "nothing"); log.length = 0; };
const attempt = async (what, run) => { try { console.log(what, await run()); } catch (error) { console.log(what, "throws", error.name, String(error.message).slice(0, 70)); } show(what); };

Object.defineProperty(holder, "custom", { get() { note("get"); return 1; }, enumerable: true, configurable: true });
let file;
try { file = await import("./reads.mjs"); show("import"); } catch (error) { console.log("import throws", error.name, String(error.message).slice(0, 90)); show("import"); }
if (file) {
await attempt("read", () => file.custom + file.custom);
}

// FILE: reads.mjs
export { custom } from "node:process"; note("starts");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show attempt get
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=":"
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="log"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: Jump -> next b5(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = String string="nothing"
// CHECK-NEXT: Jump -> next b5(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = Call v5, v3, v7, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="log"
// CHECK-NEXT: v23 = Integer
// CHECK-NEXT: v24 = Convert v23 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v22, v24 key="length"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="run"
// CHECK-NEXT: v8 = Await v7, v0, v1
// CHECK-NEXT: v9 = Call v6, v4, v0, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="throws"
// CHECK-NEXT: v17 = PropGet v10 key="name"
// CHECK-NEXT: v18 = Builtin builtin=String
// CHECK-NEXT: v19 = PropGet v10 key="message"
// CHECK-NEXT: v20 = Call v18, -, v19 calleeName="String"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="slice"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v24 = Integer
// CHECK-NEXT: v25 = Integer integer=70
// CHECK-NEXT: v26 = Call v23, v21, v24, v25 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v15, v13, v0, v16, v17, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="show"
// CHECK-NEXT: v31 = Call v30, -, v0 calleeName="show"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="note" [isFreeName]
// CHECK-NEXT: v2 = String string="get"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="note"
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
