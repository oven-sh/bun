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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="main"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="early"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="counter"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="counter"
// CHECK-NEXT: v12 = TypeOf v11
// CHECK-NEXT: v13 = Call v4, v2, v5, v7, v9, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="inc"
// CHECK-NEXT: v16 = Call v15 calleeName="inc"
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="counter"
// CHECK-NEXT: v24 = Call v21, v19, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="setText"
// CHECK-NEXT: v27 = Call v26 calleeName="setText"
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="console" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="log"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v34 = CheckInitialized v33 name="counter"
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v36 = CheckInitialized v35 name="counter"
// CHECK-NEXT: v37 = TypeOf v36
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v39 = CheckInitialized v38 name="counter"
// CHECK-NEXT: v40 = Integer integer=1
// CHECK-NEXT: v41 = Add v39, v40
// CHECK-NEXT: v42 = Call v32, v30, v34, v37, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v43 = Builtin builtin=GlobalThis
// CHECK-NEXT: v44 = PropGet v43 key="console" [isFreeName]
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v46 = PropGet v45 key="log"
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v48 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v49 = CheckInitialized v48 name="later"
// CHECK-NEXT: v50 = Call v49 calleeName="later"
// CHECK-NEXT: v51 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v52 = CheckInitialized v51 name="K"
// CHECK-NEXT: v53 = Construct v52 calleeName="K"
// CHECK-NEXT: v54 = PropGet v53 key="v"
// CHECK-NEXT: v55 = Call v47, v45, v50, v54 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v56 = Undefined
// CHECK-NEXT: Return v56
// CHECK-NEXT: }
