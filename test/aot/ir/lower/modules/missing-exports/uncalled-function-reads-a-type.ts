// RUN: lower
// DIAGNOSTIC: TS100200 main.ts:1

// FILE: main.ts
import { Shape } from "./shape";
function unused() {
  // @ts-ignore
  return Shape;
}
console.log(typeof unused);

// FILE: shape.ts
export interface Shape {
  a: number;
}
console.log("shape");
