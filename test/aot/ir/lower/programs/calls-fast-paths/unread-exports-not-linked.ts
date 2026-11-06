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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsSloppy, HasThis, IsChecked, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ToThis v1
// CHECK-NEXT: v3 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v6 = TypeTest v5 testedType=undefined|null
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=NotDestructurable name="used"
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = PropGet v9 key="used"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_4]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = PropGet v9 key="UsedClass"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_5]]} illTypedCause=Assertion
// CHECK-NEXT: v14 = PropGet v9 key="usedTable"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_6]]} illTypedCause=Assertion
// CHECK-NEXT: v16 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="lines"
// CHECK-NEXT: v18 = PropGet v17 key="push"
// CHECK-NEXT: v19 = Call v11 calleeName="used"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v21 = Construct v13 calleeName="UsedClass"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v23 = PropGet v22 key="usedMethod"
// CHECK-NEXT: v24 = Call v23, v22 calleeKey="usedMethod" calleeName="usedMethod"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = Builtin builtin=String
// CHECK-NEXT: v27 = PropGet v15 key="usedEntry"
// CHECK-NEXT: v28 = Call v26, -, v27 calleeName="String"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v30 = Call v18, v17, v20, v25, v29 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v31 = Convert v30 declared={type=number site=[[w_11]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v35 = Boolean boolean=true
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|object site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v38 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v39 = CheckInitialized v38 name="lines"
// CHECK-NEXT: v40 = PropGet v39 key="push"
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="used"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|[[f_4]] site=[[w_14]]} illTypedCause=Assertion
// CHECK-NEXT: v44 = TypeOf v43
// CHECK-NEXT: v45 = Call v40, v39, v44 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v46 = Convert v45 declared={type=number site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: }
