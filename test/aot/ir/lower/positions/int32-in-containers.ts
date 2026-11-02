// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|Array<i32> site=[[a]] flags=[OmitsNull]}
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|Map<undefined|null|string, i32> site=[[b]] flags=[OmitsNull]}
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|[[signature]] site=[[c]] flags=[OmitsNull]}
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|i32|string|absent site=[[d]] flags=[IsInt32Promise, OmitsNull]}
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|i32|absent site=[[e]] flags=[IsInt32Promise]}
// CHECK: function [[signature]] module=[[entry]] role=Signature

// RUN(PROMISES): lower
// PROMISES-NOT: IsInt32Promise
// PROMISES: = Convert {{*}}declared={type=undefined|null|i32|string site=w{{*}} flags=[IsInt32Promise, OmitsNull]}
// PROMISES-NOT: IsInt32Promise
// PROMISES: = Convert {{*}}declared={type=undefined|i32 site=w{{*}} flags=[IsInt32Promise]}
// PROMISES-NOT: IsInt32Promise

// A position asks for the proof where the value it takes is the `int32`, alone or as a member of a union. The contents of a
// container and the parameters and the result of a function type ask for none.

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export let a: int32[];
export let b: Map<string, int32>;
export let c: (x: int32) => int32;
export let d: int32 | string;
export let e: int32 | undefined;
