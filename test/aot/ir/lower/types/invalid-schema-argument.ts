
// RUN: link
// CHECK: variable {{*}}name="bounded" module=[[entry]] declared={type=undefined|number|absent site=w{{*}}}
// CHECK: variable {{*}}name="either" module=[[entry]] declared={type=undefined|number|absent site=w{{*}}}
// CHECK: variable {{*}}name="unbounded" module=[[entry]] declared={type=undefined|number|absent site=w{{*}}}

/// <reference path="./imports/bun-declarations.d.ts" />

import type { Schema } from "bun";

// `undefined` is what a `let` without an initializer holds. An argument that says no rule takes nothing from what is known about the variable: only a validator is refused.
export let bounded: number & Schema.Min<1>;
export let either: number & Schema.Min<1 | 2>;
export let unbounded: number & Schema.Min<number>;
