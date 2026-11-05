// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// values.js is imported for one name. Its other exports are read by nobody, and their initializers call something, are marked pure, or are plain values. `bun run` runs all of them. `bun build --compile` drops the call marked pure and nothing else, and --aot follows it.
import { used, log } from "./values.js";

console.log(used);
console.log(log.join("\n"));

// FILE: values.js
export const log = [];
function effect(name) { log.push(name); return name; }

export const used = effect("used");
export const unusedCall = effect("an unused export with a call");
export const unusedMarked = /* @__PURE__ */ effect("an unused export with a call marked pure");
export const unusedPlain = 1;
export let unusedLet = effect("an unused let");
export var unusedVar = effect("an unused var");
export class UnusedClass { static field = effect("a static field of an unused exported class"); }
export default effect("an unused default export");
export const { unusedFromPattern = effect("a default in the pattern of an unused export") } = {};

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
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="used"
// CHECK-NEXT: v7 = Call v4, v2, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="\n"
// CHECK-NEXT: v19 = Call v17, v15, v18 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v12, v10, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
