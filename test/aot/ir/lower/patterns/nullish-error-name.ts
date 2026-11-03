// RUN: lower
// CHECK-LABEL: function {{*}}name="bigint"
// CHECK: = NewRuntimeError runtimeError=NotDestructurable name="1"
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: = NewRuntimeError runtimeError=NotDestructurable @
// CHECK-LABEL: function {{*}}name="identifier"
// CHECK: = NewRuntimeError runtimeError=NotDestructurable name="a"
// CHECK-LABEL: function {{*}}name="rest"
// CHECK: = NewRuntimeError runtimeError=NotDestructurable @
// CHECK-LABEL: function {{*}}name="string"
// CHECK: = NewRuntimeError runtimeError=NotDestructurable name="b c"

export function bigint(v: any) {
  const { 1n: z } = v;
  return z;
}

export function computed(v: any, k: any) {
  const { [k]: y } = v;
  return y;
}

export function identifier(v: any) {
  const { a } = v;
  return a;
}

export function rest(v: any) {
  const { ...r } = v;
  return r;
}

export function string(v: any) {
  const { "b c": x } = v;
  return x;
}
