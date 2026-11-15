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
