
// RUN: link
// CHECK: variable {{*}}name="bounded" module=[[entry]] declared={type=undefined|number|absent site=w{{*}}}
// CHECK: variable {{*}}name="either" module=[[entry]] declared={type=anything|absent}
// CHECK: variable {{*}}name="unbounded" module=[[entry]] declared={type=anything|absent}

/// <reference path="./imports/bun-declarations.d.ts" />

import type { Schema } from "bun";

// `undefined` is what a `let` without an initializer holds. An argument that says no rule leaves nothing known about the variable.
export let bounded: number & Schema.Min<1>;
export let either: number & Schema.Min<1 | 2>;
export let unbounded: number & Schema.Min<number>;
