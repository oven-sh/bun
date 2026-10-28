// RUN: link
// CHECK: variable {{*}}name="extended" module=[[entry]] declared={type=undefined|null|absent|Uint8Array site=
// CHECK: variable {{*}}name="redeclared" module=[[entry]] declared={type=undefined|null|absent|Int8Array flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="spelled" module=[[entry]] declared={type=undefined|null|absent|Int8Array site=
// CHECK: variable {{*}}name="untouched" module=[[entry]] declared={type=undefined|null|absent|Float64Array site=

/// <reference path="./imports/more-members-of-bytes.d.ts" />

// A declaration file adds a member to Uint8Array, as bun-types does. The type argument that is left out is the default library's, so the type is checked.
export let extended: Uint8Array;
// Here the declaration file states the default too. A type argument that comes from a declaration file is not trusted, so the type is only expected.
export let redeclared: Int8Array;
export let spelled: Int8Array<ArrayBuffer>;
export let untouched: Float64Array;
