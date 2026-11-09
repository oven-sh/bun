// RUN: lower
// CHECK-LABEL: function {{*}}name="List" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: ElemSet
// CHECK: PropSet {{*}}key="a"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="TypeOfName" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: ElemSet
// CHECK: PropSet {{*}}key="b"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="FunctionAnd" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: ElemSet
// CHECK: PropSet {{*}}key="c"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="NotPattern" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: ElemSet
// CHECK: PropSet {{*}}key="d"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="ListOfCall" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set
// CHECK-LABEL: function {{*}}name="ListAnd" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set

// `bun build` writes nothing for a list, a function, a pattern or `typeof name` that only picks the key, so it has a string in the brackets and assigns the fields.
// The build runs the key as it is written: the name may be in its dead zone, and `typeof` may run a getter of the global object.
declare function f(): number;
let local = f();

export class List {
  // @ts-expect-error
  [[local, {}] ? "list" : "other"] = 1;
  a = 2;
  unset?: number;
}

export class TypeOfName {
  // @ts-expect-error
  [typeof someGlobal ? "type" : "other"] = 1;
  b = 2;
  unset?: number;
}

export class FunctionAnd {
  // @ts-expect-error
  [(() => 1) && "function"] = 1;
  c = 2;
  unset?: number;
}

export class NotPattern {
  // @ts-expect-error
  [!/x/ || "pattern"] = 1;
  d = 2;
  unset?: number;
}

// `(f(), "call")` and `[] && "and"` stay in the brackets.
export class ListOfCall {
  // @ts-expect-error
  [[f()] ? "call" : "other"] = 1;
  e = 2;
  unset?: number;
}

export class ListAnd {
  // @ts-expect-error
  [[] && "and"] = 1;
  g = 2;
  unset?: number;
}
