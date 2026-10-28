// RUN: link
// CHECK: function {{*}}name="own"{{*}}parameters=[{type=i32 site={{*}} flags=[IsInt32Promise]}]

// RUN(PACKAGE): link
// PACKAGE: function {{*}}name="twice"{{*}}parameters=[{type=i32 site={{*}} flags=[IsInt32Promise, IsDeclaredByDependency]}]

// Who builds the program cannot mend a package. The engine is told which promises are a package's: where it cannot prove one of them the build goes on.

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";
import { twice } from "counts-in-int32";

export function own(n: int32): number {
  return twice(n);
}
