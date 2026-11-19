// `bun build` has a value for a member where its visit of the initializer ends in a number or a text, in a function as at the top of a file, and has it in place of a callee too. It compares like with like alone. A constant from outside the function is in place of its name, as under `bun run`.
// RUN: lower
// CHECK-LABEL: function {{*}}name="called"
// CHECK: = Data data=
// CHECK-NOT: PropGet
// CHECK: [[member]] = Integer integer=1 @
// CHECK-NEXT: = Call [[member]] calleeName="Local.first"
// CHECK-LABEL: function {{*}}name="inPlace"
// CHECK-NOT: PropSet
// CHECK: = Data data=
// CHECK: [[chosen]] = Integer integer=5 @
// CHECK-NEXT: [[either]] = Integer integer=2 @
// CHECK-NEXT: [[asserted]] = Integer integer=11 @
// CHECK-NEXT: [[compared]] = Integer integer=7 @
// CHECK-NEXT: = Call {{*}}, [[chosen]], [[either]], [[asserted]], [[compared]] calleeName="use"
// CHECK-LABEL: function {{*}}name="leftToTheObject"
// CHECK-NOT: = PropGet {{*}}key="fromConstant"
// CHECK: = PropGet {{*}}key="unlike"
// CHECK-NOT: = PropGet {{*}}key="fromConstant"

declare function use(...values: unknown[]): void;

const limit = 7;

export function called() {
  enum Local {
    first = 1,
  }
  (Local.first as unknown as () => void)();
}

export function inPlace() {
  enum Local {
    first = 1,
    chosen = first ? 5 : 6,
    either = first && 2,
    asserted = (first as number) + 10,
    compared = first === 1 ? 7 : 8,
  }
  use(Local.chosen, Local.either, Local.asserted, Local.compared);
}

export function leftToTheObject() {
  enum Local {
    first = 1,
    fromConstant = limit,
    unlike = (first as unknown) === "1" ? 3 : 4,
  }
  use(Local.fromConstant, Local.unlike);
}
