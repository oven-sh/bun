// RUN: link
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=i32|absent flags=[IsInt32Promise]}
// CHECK: function [[body]] module=[[entry]] kind=Module
// CHECK: = Convert {{*}}declared={type=i32}

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export let v: int32 = 1;
