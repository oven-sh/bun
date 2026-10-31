// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
import { Constant, Text } from "./texts";

console.log(Text.Both, Text.OfMember, Text.InBrackets, Text.Plain);
console.log(Text.Computed, Text.Negative, Text.Joined);
console.log(Constant.B, Constant.C, JSON.stringify([Constant.A, Constant.B, Text.One, Text.Both]));

enum Local {
  Two = 2,
  Text = `two is ${Two}`,
  Longer = `${Local.Text}, twice ${Two * 2}`,
}
console.log(Local.Text, Local.Longer, Local[2]);

// FILE: texts.ts
export enum Text {
  One = 1,
  Name = "name",
  Both = `a${One}b${Name}c`,
  OfMember = `${Text.Both}!`,
  InBrackets = `<${Text["Name"]}>`,
  Plain = `plain`,
  Computed = `n${1 + 3 - (4 / 2) * 5 ** 2}`,
  Negative = `${-One}|${~One}`,
  Joined = `x${One}` + Name,
}

export const enum Constant {
  A = 123,
  B = `a${A}b`,
  C = `${Constant.B}${Constant["A"]}`,
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="a1bnamec"
// CHECK-NEXT: v7 = String string="a1bnamec!"
// CHECK-NEXT: v8 = String string="<name>"
// CHECK-NEXT: v9 = String string="plain"
// CHECK-NEXT: v10 = Call v5, v3, v6, v7, v8, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="n-46"
// CHECK-NEXT: v17 = String string="-1|-2"
// CHECK-NEXT: v18 = String string="x1name"
// CHECK-NEXT: v19 = Call v15, v13, v16, v17, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = String string="a123b"
// CHECK-NEXT: v26 = String string="a123b123"
// CHECK-NEXT: v27 = Builtin builtin=JSON
// CHECK-NEXT: v28 = PropGet v27 key="stringify"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v30 = Integer integer=123
// CHECK-NEXT: v31 = String string="a123b"
// CHECK-NEXT: v32 = Integer integer=1
// CHECK-NEXT: v33 = String string="a1bnamec"
// CHECK-NEXT: v34 = NewArray v30, v31, v32, v33 contents=anything
// CHECK-NEXT: v35 = Call v29, v27, v34 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v37 = Call v24, v22, v25, v26, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Integer integer=2
// CHECK-NEXT: v39 = String string="Two"
// CHECK-NEXT: v40 = String string="two is 2"
// CHECK-NEXT: v41 = String string="two is 2, twice 4"
// CHECK-NEXT: v42 = NewObject -, v38, v40, v41 layout=[[L_2]] fields=[0, 1, 2]
// CHECK-NEXT: ElemDefine v42, v38, v39
// CHECK-NEXT: v44 = FinishObject v42
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="console" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="log"
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v50 = String string="two is 2"
// CHECK-NEXT: v51 = String string="two is 2, twice 4"
// CHECK-NEXT: v52 = Convert v44 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v53 = Integer integer=2
// CHECK-NEXT: v54 = ElemGet v52, v53
// CHECK-NEXT: v55 = Convert v54 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v56 = Call v49, v47, v50, v51, v55 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v57 = Undefined
// CHECK-NEXT: Return v57
// CHECK-NEXT: }
