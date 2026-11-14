// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]] fields=[1]
// CHECK: PutEnvironmentField [[environment]], {{*}}layout=[[layout]] @
// CHECK: [[parameter]] = GetEnvironmentField [[environment]] layout=[[layout]] @
// CHECK-NEXT: [[value]] = CheckInitialized [[parameter]] name="a"
// CHECK-NEXT: [[convertedValue]] = Convert [[value]] declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField [[environment]], [[convertedValue]] layout=[[layout]] field=1
// CHECK: = NewClosure [[environment]] function=

export function f(a, b = () => a++) {
  var a;
  return [() => a++, b];
}
