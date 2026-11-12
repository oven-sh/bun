// The row is TypeScript, with types among its exports.
import * as all from "./t3";
import { type Shape, v0 } from "./t3";
const shape: Shape = { side: 2 };
const one: all.Shape = { side: 3 };
console.log(all.v0 + all.v3, v0, shape.side + one.side, all.Kind.Round);
