// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=anything|absent}
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=anything|absent}
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=anything|absent}
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=anything|absent}

// RUN(SITES): lower
// SITES-NOT: site=

export let a: any;
export let b: unknown;
export let c: {};
export let d: void;
