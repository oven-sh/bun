// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// A store to a binding that was imported through a re-export.
import * as ns from "./m.js";
const log = []; const note = (x) => (log.push(x), x);
const tell = (name, f) => { try { const r = f(); console.log(name + ": " + (typeof r === "function" ? "function" : String(r))); } catch (e) { console.log(name + ": threw " + e.name); } };
import * as mid from "./mid.js";
tell("first", () => ns.inside());
for (const V of [7, 1.5, "text", { a: 9 }, () => "second", null, undefined]) {
  log.length = 0;
  tell("the store", () => { mid.inner.k = note(V); });
  tell("evaluated", () => log.map((x) => typeof x === "function" ? "function" : typeof x === "object" && x ? "object" : String(x)).join());
  tell("outside", () => typeof ns.k);
  tell("inside", () => ns.inside());
  tell("hot", () => ns.hot());
}

// FILE: m.js
export const k = () => "first";
export const inside = () => { try { return typeof k === "function" ? (k.who ? k.who() : k()) : typeof k === "object" ? "object " + k.a : "value " + (k + 1); } catch (e) { return "threw " + e.name; } };
export function hot() { let r; for (let i = 0; i < 50; i++) r = inside(); return r; }

// FILE: mid.js
export * as inner from "./m.js";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: note tell
// CHECK-LABEL: function {{*}}name="note"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|[[L_1]]|[[f_2]] flags=[IsExpected]}] results=[{type=undefined|null|number|string|[[L_1]]|[[f_2]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|[[L_1]]|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|number|string|[[L_1]]|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v2 = Call v1 calleeName="f"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string=": "
// CHECK-NEXT: v9 = Add v0, v8
// CHECK-NEXT: v10 = TypeTest v2 testedType=function
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v11) handler=b9():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: v12 = String string="function"
// CHECK-NEXT: Jump -> next b7(v12)
// CHECK-NEXT: b5(v13) handler=b9():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b9():
// CHECK-NEXT: v14 = Builtin builtin=String
// CHECK-NEXT: v15 = Call v14, -, v13 calleeName="String"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v16)
// CHECK-NEXT: b7(v17) handler=b9():
// CHECK-NEXT: v18 = Add v9, v17
// CHECK-NEXT: v19 = Call v7, v5, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b9() role=CatchHandler:
// CHECK-NEXT: v20 = CatchValue
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="log"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v26 = String string=": threw "
// CHECK-NEXT: v27 = Add v0, v26
// CHECK-NEXT: v28 = PropGet v20 key="name"
// CHECK-NEXT: v29 = Add v27, v28
// CHECK-NEXT: v30 = Call v25, v23, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
