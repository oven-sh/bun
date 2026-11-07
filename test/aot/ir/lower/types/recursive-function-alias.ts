// RUN: link
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=undefined|null|absent|[[signature]] site=
// CHECK: function [[signature]] module=[[entry]] role=Signature

type F = (next: F) => void;

export let v: F;
