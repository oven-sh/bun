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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=":"
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="log"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v14):
// CHECK-NEXT: Jump -> next b3(v14)
// CHECK-NEXT: b2(v15):
// CHECK-NEXT: v16 = String string="nothing"
// CHECK-NEXT: Jump -> next b3(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: v18 = Call v5, v3, v7, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="log"
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: PropSet v20, v21 key="length"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="run"
// CHECK-NEXT: v8 = Await v7, v0, v1
// CHECK-NEXT: v9 = Call v6, v4, v0, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
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
// CHECK-NEXT: v21 = PropGet v20 key="slice"
// CHECK-NEXT: v22 = Integer
// CHECK-NEXT: v23 = Integer integer=70
// CHECK-NEXT: v24 = Call v21, v20, v22, v23 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v25 = Call v15, v13, v0, v16, v17, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="show"
// CHECK-NEXT: v28 = Call v27, -, v0 calleeName="show"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="note" [isFreeName]
// CHECK-NEXT: v2 = String string="get"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="note"
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
