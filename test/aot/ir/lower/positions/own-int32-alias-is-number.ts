// RUN: link
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=undefined|number|absent}

// RUN(PROMISES): lower
// PROMISES-NOT: IsInt32Promise

type int32 = number;

export let v: int32;
