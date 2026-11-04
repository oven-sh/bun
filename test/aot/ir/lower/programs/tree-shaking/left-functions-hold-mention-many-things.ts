// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// The bodies that are left out are the only places that mention a library module's function, a global, a regular expression, a template, a big number, a private name, an import() and a JSX-free tagged template. What is left of the file builds and runs without them.
import { helper } from "./helper";

function mentionsLibrary() { return require("node:fs").readFileSync("/dev/null").length; }
function mentionsGlobals() { return [structuredClone, queueMicrotask, WebSocket, Intl.DateTimeFormat, WeakRef, Atomics, SharedArrayBuffer].length; }
function mentionsLiterals() { return [/(?<year>\d{4})/u.exec("2026")?.groups?.year, 123456789012345678901234567890n, `a${1}b`, String.raw`\n`, 0x1fn, 1_000]; }
async function mentionsImport() { return (await import("./late")).late(); }
function mentionsHelper() { return helper(); }
function mentionsBun() { return [Bun.file("/dev/null").size, Bun.hash("x"), Bun.version]; }
class MentionsPrivate { #a = 1; static has(value: object) { return #a in value; } }

console.log("built and ran");

// FILE: helper.ts
console.log("helper.ts is evaluated");
export function helper() { return "helper"; }

// FILE: late.ts
console.log("late.ts is evaluated");
export function late() { return "late"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = NewClosure function=[[f_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = NewClosure function=[[f_5]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[f_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v10 = NewClosure function=[[f_6]]
// CHECK-NEXT: v11 = Convert v10 declared={type=[[f_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="built and ran"
// CHECK-NEXT: v18 = Call v16, v14, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mentionsLibrary"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="mentionsLibrary"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mentionsGlobals"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="mentionsGlobals"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mentionsLiterals"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="mentionsLiterals"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mentionsImport"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="mentionsImport"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mentionsHelper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="mentionsHelper"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mentionsBun"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="mentionsBun"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
