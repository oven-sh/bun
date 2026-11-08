// RUN: lower

// An imported type that export { } hands on is no export of the file.

// FILE: main.ts
import * as handed from "./hands-on";
console.log(Object.keys(handed));

// FILE: hands-on.ts
import { Shape } from "./shape";
export { Shape };
export const value = 1;

// FILE: shape.ts
export interface Shape {
  a: number;
}
console.log("shape");
