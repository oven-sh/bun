// RUN: link
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=anything

export function f() {}
f = 1;
