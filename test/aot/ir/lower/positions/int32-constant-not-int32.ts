// RUN: lower
// DIAGNOSTIC: ConstantNotInt32
// CHECK: = Convert {{*}}flags=[IsInt32Promise]}

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export const v: int32 = 1.5;
