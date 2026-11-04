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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = String string="c"
// CHECK-NEXT: v7 = String string="t"
// CHECK-NEXT: v8 = String string="accent"
// CHECK-NEXT: v9 = String string="kanji"
// CHECK-NEXT: v10 = Double number=Infinity
// CHECK-NEXT: v11 = Builtin builtin=Object
// CHECK-NEXT: v12 = Builtin builtin=ObjectIs
// CHECK-NEXT: v13 = Double number=-0
// CHECK-NEXT: v14 = Double number=-0
// CHECK-NEXT: v15 = Call v12, v11, v13, v14 calleeName="Object.is"
// CHECK-NEXT: v16 = Convert v15 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Double number=12345678901234567000
// CHECK-NEXT: v18 = String string="\u{e9}\u{65e5}\u{672c}\u{1f600}\u{0}"
// CHECK-NEXT: v19 = PropGet v18 key="length"
// CHECK-NEXT: v20 = String string="\u{e9}\u{65e5}\u{672c}\u{1f600}\u{0}"
// CHECK-NEXT: v21 = String string="t"
// CHECK-NEXT: v22 = Integer integer=7
// CHECK-NEXT: v23 = Integer integer=3
// CHECK-NEXT: v24 = String string="zero"
// CHECK-NEXT: v25 = String string="empty"
// CHECK-NEXT: v26 = Call v4, v2, v5, v6, v7, v8, v9, v10, v16, v17, v19, v20, v21, v22, v23, v24, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
