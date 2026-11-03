// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: Build 1
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// Odd keys of a json file are imported by name.
import {
  a,
  constructor,
  toString,
  é,
  日本,
  big,
  minus,
  long,
  text,
  then,
  length,
  "with space" as spaced,
  "0" as zero,
  "" as empty,
} from "./data.json";
console.log(
  a,
  constructor,
  toString,
  é,
  日本,
  big,
  Object.is(minus, -0),
  long,
  text.length,
  text,
  then,
  length,
  spaced,
  zero,
  empty,
);

// FILE: data.json
{
  "a": 1,
  "a": 2,
  "0": "zero",
  "1.5": "frac",
  "__proto__": { "polluted": true },
  "constructor": "c",
  "toString": "t",
  "with space": 3,
  "é": "accent",
  "日本": "kanji",
  "": "empty",
  "big": 1e400,
  "minus": -0,
  "long": 12345678901234567890,
  "text": "é日本😀\u0000",
  "default": "d",
  "then": "t",
  "length": 7
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
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Convert v5 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v7 = String string="c"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v9 = String string="t"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v11 = String string="accent"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v13 = String string="kanji"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v15 = Double number=Infinity
// CHECK-NEXT: v16 = Convert v15 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v17 = Builtin builtin=Object
// CHECK-NEXT: v18 = Builtin builtin=ObjectIs
// CHECK-NEXT: v19 = Double number=-0
// CHECK-NEXT: v20 = Convert v19 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v21 = Double number=-0
// CHECK-NEXT: v22 = Call v18, v17, v20, v21 calleeName="Object.is"
// CHECK-NEXT: v23 = Convert v22 declared={type=boolean site=[[w_1]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = Double number=12345678901234567000
// CHECK-NEXT: v25 = Convert v24 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v26 = String string="\u{e9}\u{65e5}\u{672c}\u{1f600}\u{0}"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v28 = PropGet v27 key="length"
// CHECK-NEXT: v29 = Convert v28 declared={type=number site=[[w_2]]} illTypedCause=Assertion
// CHECK-NEXT: v30 = String string="\u{e9}\u{65e5}\u{672c}\u{1f600}\u{0}"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v32 = String string="t"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v34 = Integer integer=7
// CHECK-NEXT: v35 = Convert v34 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v36 = Integer integer=3
// CHECK-NEXT: v37 = Convert v36 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v38 = String string="zero"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v40 = String string="empty"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v42 = Call v4, v2, v6, v8, v10, v12, v14, v16, v23, v25, v29, v31, v33, v35, v37, v39, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v43 = Undefined
// CHECK-NEXT: Return v43
// CHECK-NEXT: }
