// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// Object assign and define property store to an enum.
import { Color } from "./color";
import { read } from "./reader";
console.log(read(), Object.keys(Color).join());
Object.assign(Color, { Green: 9 });
console.log(read());
Object.defineProperty(Color, "Red", { value: 8 });
console.log(read());

// FILE: color.ts
export enum Color {
  Red,
  Green = 5,
  Blue = "blue",
}

// FILE: reader.ts
import { Color } from "./color";
export function read() {
  return [Color.Red, Color.Green, Color.Blue, Color["Green"]].join();
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="read"
// CHECK-NEXT: v7 = Call v6 calleeName="read"
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="Color"
// CHECK-NEXT: v12 = Call v9, v8, v11 calleeName="Object.keys"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Call v14, v13 calleeKey="join" calleeName="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Call v4, v2, v7, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Builtin builtin=Object
// CHECK-NEXT: v19 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="Color"
// CHECK-NEXT: v22 = Data data=[[d_3]]
// CHECK-NEXT: v23 = Call v19, v18, v21, v22 calleeName="Object.assign"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="read"
// CHECK-NEXT: v32 = Call v31 calleeName="read"
// CHECK-NEXT: v33 = Call v29, v27, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v34 = Builtin builtin=Object
// CHECK-NEXT: v35 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v36 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v37 = CheckInitialized v36 name="Color"
// CHECK-NEXT: v38 = String string="Red"
// CHECK-NEXT: v39 = Integer integer=8
// CHECK-NEXT: v40 = NewObject -, v39 layout=[[L_5]] fields=[4]
// CHECK-NEXT: v41 = FinishObject v40
// CHECK-NEXT: v42 = Call v35, v34, v37, v38, v41 calleeName="Object.defineProperty"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v44 = Builtin builtin=GlobalThis
// CHECK-NEXT: v45 = PropGet v44 key="console" [isFreeName]
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="log"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v50 = CheckInitialized v49 name="read"
// CHECK-NEXT: v51 = Call v50 calleeName="read"
// CHECK-NEXT: v52 = Call v48, v46, v51 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v53 = Undefined
// CHECK-NEXT: Return v53
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
