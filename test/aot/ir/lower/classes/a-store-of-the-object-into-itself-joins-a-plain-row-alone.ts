// RUN: lower
// In a plain row the object is defined under its own name with the other fields: no initializer function, no store is left.
// CHECK-LABEL: function {{*}}name="Node" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropDefine [[this]], [[this]] key="next"
// CHECK: PropDefine [[this]], {{*}}key="weight"
// CHECK-NOT: PropSet
// A statement passed by in front: the row is not plain: everything is as written.
// CHECK-LABEL: function {{*}}name="CallInFront" {{*}}kind=BaseConstructor
// CHECK: = CallDirect
// CHECK-NOT: PropDefine
// CHECK: PropSet {{*}}key="me"
// CHECK: PropSet {{*}}key="n"
// A default makes blocks in front of the body: as written.
// CHECK-LABEL: function {{*}}name="Defaults" {{*}}kind=BaseConstructor
// CHECK: = CallDirect
// CHECK-NOT: PropDefine
// CHECK: PropSet {{*}}key="me"
// A value that calls behind the store of the object ends the row: its field is laid undefined and stored as written.
// CHECK-LABEL: function {{*}}name="CallsBehind" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropDefine [[self]], [[self]] key="me"
// CHECK: [[nothing]] = Undefined
// CHECK: PropDefine [[self]], [[nothing]] key="n"
// CHECK: = Call {{*}}calleeName="twice"
// CHECK: PropSet {{*}}key="n"

declare function between(): void;
declare function twice(n: number): number;

export class Node {
  next: Node;
  weight: number;
  constructor(weight: number) {
    this.next = this;
    this.weight = weight;
  }
}

export class CallInFront {
  me: CallInFront;
  n: number;
  constructor(n: number) {
    between();
    this.me = this;
    this.n = n;
  }
}

export class Defaults {
  me: Defaults;
  n: number;
  constructor(n: number = 7) {
    this.me = this;
    this.n = n;
  }
}

export class CallsBehind {
  me: CallsBehind;
  n: number;
  constructor(n: number) {
    this.me = this;
    this.n = twice(n);
  }
}
