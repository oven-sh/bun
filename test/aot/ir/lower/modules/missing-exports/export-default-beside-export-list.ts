// RUN: lower
// DIAGNOSTIC: TS100200 main.ts:1

// FILE: main.ts
import { Shape } from "./shape";
export { Shape };
export default Shape;

// FILE: shape.ts
export interface Shape {
  a: number;
}
console.log("shape");
