// `import { type A } from ..`: every name is a type: nothing is left of the statement, and the module is not evaluated for it.
import { type Point } from "./files/only_types.ts"
import { type Shape, type Name } from "./files/shapes.ts"
import { square } from "./files/shapes.ts"
export { type Point as P } from "./files/only_types.ts"
const point: Point = { x: 1 }
const shape: Shape = square
const name: Name = "square"
console.log(point.x, shape.sides, name)
