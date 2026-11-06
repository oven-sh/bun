// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// `import { type A } from ..` with only type names is erased completely, so the module is not evaluated because of it.
import { type Point } from "./files/only_types.ts"
import { type Shape, type Name } from "./files/shapes.ts"
import { square } from "./files/shapes.ts"
export { type Point as P } from "./files/only_types.ts"
const point: Point = { x: 1 }
const shape: Shape = square
const name: Name = "square"
console.log(point.x, shape.sides, name)

// FILE: files/only_types.ts
console.log("only_types is evaluated")
export interface Point { x: number }

// FILE: files/shapes.ts
console.log("shapes is evaluated")
export interface Shape { sides: number }
export type Name = string
export const square: Shape = { sides: 4 }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="square"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = String string="square"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v1 key="x"
// CHECK-NEXT: v13 = PropGet v4 key="sides"
// CHECK-NEXT: v14 = Call v11, v9, v12, v13, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
