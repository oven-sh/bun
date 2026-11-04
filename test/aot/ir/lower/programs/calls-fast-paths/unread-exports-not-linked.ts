// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// A module is imported by import(), and only some members of its namespace object are ever read. What the others export is no part of the program: neither the functions, nor the classes with their members and fields, nor the variables with what is made for them.
const lines: string[] = [];
async function all(): Promise<void> {
    const { used, UsedClass, usedTable } = await import("./things.ts");
    lines.push(used(), new UsedClass().usedMethod(), String(usedTable.usedEntry));
    const names = require("./things.ts") as typeof import("./things.ts");
    lines.push(typeof names.used);
}
all().then(() => console.log(lines.join("\n")));

// FILE: things.ts
export function neverLinked(): string { return helperOfNeverLinked(); }
function helperOfNeverLinked(): string { return "never linked"; }
export class NeverLinkedClass {
    neverLinkedField = 1;
    neverLinkedMethod(): string { return "only in the method that is never linked" + this.neverLinkedField; }
}
export const neverLinkedTable = { neverLinkedEntry: 1 };
export const neverLinkedArrow = (): number => neverLinkedTable.neverLinkedEntry;
export function used(): string { return "used"; }
export class UsedClass { usedMethod(): string { return "a method that is used"; } }
export const usedTable = { usedEntry: 2 };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: all
// CHECK-LABEL: function {{*}}name="all"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsSloppy, HasThis, IsChecked, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v3 = Await v2
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined|null
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = NewRuntimeError runtimeError=NotDestructurable name="used"
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = PropGet v7 key="used"
// CHECK-NEXT: v9 = PropGet v7 key="UsedClass"
// CHECK-NEXT: v10 = PropGet v7 key="usedTable"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="lines"
// CHECK-NEXT: v13 = PropGet v12 key="push"
// CHECK-NEXT: v14 = Call v8 calleeName="used"
// CHECK-NEXT: v15 = Construct v9 calleeName="UsedClass"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v17 = PropGet v16 key="usedMethod"
// CHECK-NEXT: v18 = Call v17, v16 calleeKey="usedMethod" calleeName="usedMethod"
// CHECK-NEXT: v19 = Builtin builtin=String
// CHECK-NEXT: v20 = PropGet v10 key="usedEntry"
// CHECK-NEXT: v21 = Call v19, -, v20 calleeName="String"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Call v13, v12, v14, v18, v22 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v24 = Convert v23 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v28 = Boolean boolean=true
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="lines"
// CHECK-NEXT: v31 = PropGet v30 key="push"
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="used"
// CHECK-NEXT: v34 = TypeOf v33
// CHECK-NEXT: v35 = Call v31, v30, v34 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v36 = Convert v35 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
