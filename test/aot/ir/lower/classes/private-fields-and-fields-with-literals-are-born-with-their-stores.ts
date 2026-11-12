// RUN: lower
// The brand of the private method is laid first, then the fields in the order of their declarations, each with what the row stores: no initializer function, no store is left. The call amid the row comes before the allocation.
// CHECK-LABEL: function {{*}}name="Hidden" {{*}}kind=BaseConstructor
// CHECK-NOT: NewObject
// CHECK-NOT: CallDirect
// CHECK: = Call {{*}}calleeName="between"
// CHECK: = NewObject
// CHECK: PrivateDefine
// CHECK: PrivateDefine
// CHECK: PropDefine {{*}}key="open"
// CHECK: PropDefine {{*}}key="list"
// CHECK-NOT: PrivateSet
// CHECK-NOT: PropSet
// A store to a field whose initializer names nothing joins the row, also where no field beside it lays undefined: the literal is never made.
// CHECK-LABEL: function {{*}}name="Counted" {{*}}kind=BaseConstructor
// CHECK-NOT: Integer integer=41
// CHECK: PropDefine {{*}}key="count"
// CHECK-NOT: PropSet

// RUN(NONE): lower
// NONE-NOT: kind=Initializer

declare function between(): void;

export class Hidden {
  #x: number;
  open: number;
  list: number[] = [];
  constructor(x: number, open: number) {
    this.open = open;
    between();
    this.#x = x;
  }
  #twice(): number { return this.#x * 2; }
  get twice(): number { return this.#twice(); }
}

export class Counted {
  count = 41;
  constructor(count: number) {
    this.count = count;
  }
}
