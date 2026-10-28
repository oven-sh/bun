// RUN: link
// OPTIONS: type-errors=log
// CHECK: typesite [[site]] module=[[entry]] {{*}}kind=Variable text="int32"
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=i32|absent site=[[site]] flags=[IsInt32Promise]}
// CHECK: function [[body]] module=[[entry]] kind=Module
// CHECK: = Convert {{*}}declared={type=i32 site=[[site]] flags=[IsInt32Promise]}

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export let v: int32 = 1;
