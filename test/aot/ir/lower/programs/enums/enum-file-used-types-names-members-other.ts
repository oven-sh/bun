// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// The members are made of members of another enum of the file, of an enum in a namespace of the file, and of an enum of a third file, which is used for its types alone too.
import { Sum } from "./sum";
function describe(sum: Sum): string {
  return "sum " + sum;
}
console.log(describe(1), describe(6), describe(24), describe(31));

// FILE: far.ts
export enum Far {
  Eight = 8,
  Sixteen = Far.Eight * 2,
}

// FILE: sum.ts
import { Far } from "./far";
enum Near {
  One = 1,
}
namespace Inner {
  export enum Deep {
    Two = 2,
    Four = Deep.Two << 1,
  }
}
export enum Sum {
  First = Near.One,
  Second = Inner.Deep.Two | Inner.Deep.Four,
  Third = Far.Eight | Far.Sixteen,
  All = Sum.First | Sum.Second | Sum.Third,
}

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
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Call v1, -, v7 calleeName="describe"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Integer integer=6
// CHECK-NEXT: v11 = Call v1, -, v10 calleeName="describe"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Integer integer=24
// CHECK-NEXT: v14 = Call v1, -, v13 calleeName="describe"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = Integer integer=31
// CHECK-NEXT: v17 = Call v1, -, v16 calleeName="describe"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = Call v6, v4, v9, v12, v15, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 site=[[w_6]]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="sum "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
