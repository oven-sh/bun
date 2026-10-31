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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="read"
// CHECK-NEXT: v7 = Call v6 calleeName="read"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="Color"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v14 = Call v10, v9, v13 calleeName="Object.keys"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = PropGet v15 key="join"
// CHECK-NEXT: v17 = Call v16, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = Call v4, v2, v8, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Builtin builtin=Object
// CHECK-NEXT: v21 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="Color"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v25 = Data data=[[d_5]]
// CHECK-NEXT: v26 = Call v21, v20, v24, v25 calleeName="Object.assign"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="console" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="log"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v34 = CheckInitialized v33 name="read"
// CHECK-NEXT: v35 = Call v34 calleeName="read"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v37 = Call v32, v30, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Builtin builtin=Object
// CHECK-NEXT: v39 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v40 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v41 = CheckInitialized v40 name="Color"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v43 = String string="Red"
// CHECK-NEXT: v44 = Integer integer=8
// CHECK-NEXT: v45 = NewObject -, v44 layout=[[L_9]] fields=[4]
// CHECK-NEXT: v46 = FinishObject v45
// CHECK-NEXT: v47 = Call v39, v38, v42, v43, v46 calleeName="Object.defineProperty"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|object site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v49 = Builtin builtin=GlobalThis
// CHECK-NEXT: v50 = PropGet v49 key="console" [isFreeName]
// CHECK-NEXT: v51 = Convert v50 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v52 = PropGet v51 key="log"
// CHECK-NEXT: v53 = Convert v52 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v54 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v55 = CheckInitialized v54 name="read"
// CHECK-NEXT: v56 = Call v55 calleeName="read"
// CHECK-NEXT: v57 = Convert v56 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v58 = Call v53, v51, v57 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v59 = Undefined
// CHECK-NEXT: Return v59
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
