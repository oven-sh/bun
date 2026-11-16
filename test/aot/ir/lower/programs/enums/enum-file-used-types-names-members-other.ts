// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// CHECK-LABEL: function {{*}}name="describe"

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
