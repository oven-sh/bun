// RUN: link
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=undefined|null|absent|[[signature]]
// CHECK: function [[signature]] module=[[entry]] role=Signature

type F = (next: F) => void;

export let v: F;
