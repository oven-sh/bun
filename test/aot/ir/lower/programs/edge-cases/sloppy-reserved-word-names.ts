// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// A sloppy file names variables `package`, `interface` and `static`, deletes a name and reads `arguments.callee`.
// @ts-ignore
import old from "./old.js";
console.log(old.sum, old.gone, old.callee, old.octal);

// FILE: old.js
var package = 1, interface = 2, static = 3;
var x = 5;
var gone = delete x;
function f(a, a2) { return arguments.callee === f }
module.exports = { sum: package + interface + static, gone: gone, callee: f(1, 2), octal: 010 };

// FILE: tsconfig.json
{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "types": [], "lib": ["esnext", "dom"] }, "include": ["main.ts"] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v9 = Call v4, v2, v5, v6, v7, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
