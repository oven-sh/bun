// RUN: link
// CHECK: layout [[layout]] kind=Environment {{*}}fields=[{key=@"binding.0" declared={type=number|absent site=w{{*}}}
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[environment]] = NewObject layout=[[layout]]
// CHECK: = NewClosure [[environment]] function=
// CHECK: PutEnvironmentField [[environment]], {{*}}layout=[[layout]]
// CHECK-LABEL: function {{*}}name="g"
// CHECK: [[x]] = GetEnvironmentField {{*}}layout=[[layout]]
// CHECK-NEXT: = CheckInitialized [[x]] name="x"

// RUN(ZONE): lower
// ZONE-NOT: = Absent

export function f() {
  const g = () => x;
  let x = 1;
  x = 2;
  return g;
}
