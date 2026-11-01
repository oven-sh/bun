// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A class and a typedef of a js module are imported as types in typescript.
import type { Level, Pair } from "./library.js";

function sum(pair: Pair, level: Level): number {
  return pair.first + pair.second + level;
}
console.log(sum({ first: 1, second: 2, sum: () => 3 }, 2));

// FILE: library.js
export class Pair {
  /** @param {number} first */
  constructor(first) {
    this.first = first;
    this.second = 2;
  }
  sum() {
    return this.first + this.second;
  }
}
/** @typedef {number} Level */
export const Level = { Low: 1, High: 2 };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: v11 = NewClosure function=[[f_2]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v13 = NewObject -, v8, v10 layout=[[L_4]] fields=[0, 1]
// CHECK-NEXT: PropDefine v13, v12 key="sum"
// CHECK-NEXT: v15 = FinishObject v13
// CHECK-NEXT: v16 = Integer integer=2
// CHECK-NEXT: v17 = Call v1, -, v15, v16 calleeName="sum"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v19 = Call v6, v4, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="first"
// CHECK-NEXT: v3 = PropGet v0 key="second"
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Add v4, v1
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_7]]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=3
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
