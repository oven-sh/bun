// RUN: link
// STATISTIC: SchemaArgumentsDropped = 0
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=undefined|number|absent site=w{{*}}}

/// <reference path="./imports/bun-declarations.d.ts" />

import type { Schema } from "bun";

// `undefined` is what a `let` without an initializer holds.
export let v: number & Schema.Min<1>;
