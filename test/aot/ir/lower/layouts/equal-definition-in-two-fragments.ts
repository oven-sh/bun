// RUN: link
// CHECK-COUNT-1: layout {{*}}fields=[{key="a"
// CHECK-NOT: layout {{*}}name="Shape"

// RUN(ALLOCATIONS): link
// ALLOCATIONS: layout [[shape]] {{*}}fields=[{key="a"
// ALLOCATIONS-COUNT-2: = NewObject {{*}}layout=[[shape]] fields=[0]

import { type Shape, createShape } from "./imports/shape";

export function createLocal(a: number): Shape {
  return { a };
}

export const imported = createShape(1);
