// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// Import cycles: a hoisted function of a module whose body has not run reads its let, const, var, class; live bindings change value and type.
import { early, counter, inc, setText, later, K } from "./a.js";
console.log("main", early, counter, typeof counter);
inc(); console.log(counter); setText(); console.log(counter, typeof counter, counter + 1);
console.log(later(), new K().v);

// FILE: a.js
import { probe } from "./b.js";
export let counter = 0;
export function inc() { counter++; }
export function setText() { counter = "text"; }
export const early = probe;
const secret = { v: 42 };
var hoisted = "set";
export class K { v = secret.v; }
export function peek() { const out = []; for (const f of [() => secret.v, () => hoisted, () => counter, () => new K().v, () => typeof inc]) { try { out.push(String(f())); } catch (e) { out.push(e.name); } } return out.join(); }
export function later() { return peek(); }

// FILE: b.js
import { peek } from "./a.js";
export const probe = peek();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="main"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="early"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="counter"
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="counter"
// CHECK-NEXT: v14 = TypeOf v13
// CHECK-NEXT: v15 = Call v4, v2, v5, v8, v11, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="inc"
// CHECK-NEXT: v18 = Call v17 calleeName="inc"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="counter"
// CHECK-NEXT: v26 = Convert v25 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v23, v21, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="setText"
// CHECK-NEXT: v30 = Call v29 calleeName="setText"
// CHECK-NEXT: v31 = Builtin builtin=GlobalThis
// CHECK-NEXT: v32 = PropGet v31 key="console" [isFreeName]
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v33 key="log"
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v36 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v37 = CheckInitialized v36 name="counter"
// CHECK-NEXT: v38 = Convert v37 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v40 = CheckInitialized v39 name="counter"
// CHECK-NEXT: v41 = TypeOf v40
// CHECK-NEXT: v42 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v43 = CheckInitialized v42 name="counter"
// CHECK-NEXT: v44 = Convert v43 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v45 = Integer integer=1
// CHECK-NEXT: v46 = Add v44, v45
// CHECK-NEXT: v47 = Call v35, v33, v38, v41, v46 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v48 = Builtin builtin=GlobalThis
// CHECK-NEXT: v49 = PropGet v48 key="console" [isFreeName]
// CHECK-NEXT: v50 = Convert v49 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="log"
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v53 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v54 = CheckInitialized v53 name="later"
// CHECK-NEXT: v55 = Call v54 calleeName="later"
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v57 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v58 = CheckInitialized v57 name="K"
// CHECK-NEXT: v59 = Construct v58 calleeName="K"
// CHECK-NEXT: v60 = Convert v59 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v61 = PropGet v60 key="v"
// CHECK-NEXT: v62 = Convert v61 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v63 = Call v52, v50, v56, v62 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v64 = Undefined
// CHECK-NEXT: Return v64
// CHECK-NEXT: }
