// RUN: lower
// CHECK-LABEL: function {{*}}name="bitNot"
// CHECK-NEXT: ([[a]]: anything):
// CHECK: = BitNot [[a]]
// CHECK-LABEL: function {{*}}name="negate"
// CHECK: = Negate [[a]]
// CHECK-LABEL: function {{*}}name="not"
// CHECK: [[truthy]] = ToBoolean [[a]]
// CHECK-NEXT: = LogicalNot [[truthy]]
// CHECK-LABEL: function {{*}}name="plus"
// CHECK: = ToNumber [[a]]
// CHECK-LABEL: function {{*}}name="typeOf"
// CHECK: = TypeOf [[a]]
// CHECK-LABEL: function {{*}}name="voidCall"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-NEXT: [[afterCall]] = Undefined
// CHECK-NEXT: Return [[afterCall]]
// CHECK-LABEL: function {{*}}name="voidValue"
// CHECK-NOT: = Call
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: Return [[nothing]]

export function bitNot(a: any) {
  return ~a;
}

export function negate(a: any) {
  return -a;
}

export function not(a: any) {
  return !a;
}

export function plus(a: any) {
  return +a;
}

export function typeOf(a: any) {
  return typeof a;
}

export function voidCall(f: any): any {
  return void f();
}

export function voidValue(a: any): any {
  return void a;
}
