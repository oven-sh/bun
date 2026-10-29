// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: = NewObject
// CHECK-NOT: = GetModuleVariable
// CHECK: Return

// RUN(FUNCTIONS): lower
// FUNCTIONS-COUNT-1: function f
// FUNCTIONS-NOT: function f

import type { Color } from "./imports/colors";

interface I {
  color: Color;
}

type T = I | OnlyTypes.T;

declare enum Ambient {
  A,
}

declare namespace Declared {
  const value: Ambient;
}

namespace OnlyTypes {
  export type T = 1;
}

export const kept: T | typeof Declared.value | undefined = undefined;
