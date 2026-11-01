// RUN: lower
// CHECK: NewClass {{*}}layout=[[C]]
// CHECK: NewClass {{*}}layout=[[Empty]]
// CHECK-LABEL: function {{*}}name="empty"
// CHECK: [[emptyInstance]] = Construct {{*}}calleeName="Empty"
// CHECK-NEXT: [[convertedEmpty]] = Convert [[emptyInstance]] declared={type=undefined|null|boolean|number|string|symbol|bigint|[[Empty]] site=w{{*}}}
// CHECK-NEXT: Return [[convertedEmpty]]
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[instance]] = Construct [[callee]] calleeName="C"
// CHECK-NEXT: [[converted]] = Convert [[instance]] declared={type=undefined|null|[[C]] site=w{{*}}}
// CHECK-NEXT: Return [[converted]]

class C {
  x = 1;
}

// Every primitive satisfies a class without members, so its type lists them next to the layout.
class Empty {}

export function empty() {
  return new Empty();
}

export function f() {
  return new C();
}
