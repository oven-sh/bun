// Behind a test of the type of a local, an arm that reads the local reads it under a name of its own: NarrowByTest of the local and of what the edge hands over.
// The operation claims no type. Whoever asks what the value is finds the local behind it, and the engine goes on with what the test has left.
// RUN: lower
// CHECK-LABEL: function {{*}}name="both"
// CHECK: [[test]] = TypeTest [[x]] testedType=string @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[other]](| 0)
// CHECK: [[taken]]([[text]]):
// CHECK-NEXT: [[narrowed]] = NarrowByTest [[x]], [[text]]
// CHECK: = PropGet [[narrowed]] key="length"
// CHECK: [[other]]([[rest]]):
// CHECK-NEXT: [[left]] = NarrowByTest [[x]], [[rest]]
// CHECK: = PropGet [[left]] key="size"

// Where the ways behind the test meet, the local is what it was: no block takes a parameter for it.
// RUN(MEETS): lower
// MEETS-LABEL: function {{*}}name="meets"
// MEETS: = TypeTest [[x]] testedType=undefined|null @
// MEETS: = NarrowByTest [[x]],
// MEETS: Jump -> next [[after]]()
// MEETS: [[after]]():
// MEETS: Return [[x]]

// A second test asks the name that the first has left, so what it hands over stands behind both. The value behind its names is the local itself again: nobody goes through a row of names to find it.
// RUN(TWICE): lower
// TWICE-LABEL: function {{*}}name="twice"
// TWICE: = TypeTest [[x]] testedType=string @
// TWICE: [[first]] = NarrowByTest [[x]],
// TWICE: [[second]] = TypeTest [[first]] testedType=number @
// TWICE-NEXT: Branch [[second]] -> taken [[isNumber]](| 0),
// TWICE: [[isNumber]]([[number]]):
// TWICE-NEXT: = NarrowByTest [[x]], [[number]]

// An arm that does not read the local has no such operation.
// RUN(UNREAD): lower
// UNREAD-LABEL: function {{*}}name="unread"
// UNREAD-NOT: NarrowByTest
// UNREAD-LABEL: function {{*}}name="written"

// What the arm assigns is what it reads from there on, and the ways bring two values.
// RUN(WRITTEN): lower
// WRITTEN-LABEL: function {{*}}name="written"
// WRITTEN: = TypeTest [[x]] testedType=string @
// WRITTEN: [[list]] = NewArray
// WRITTEN: Jump -> next [[after]]({{*}}[[list]]
// WRITTEN: [[after]]([[merged]]{{*}}):
// WRITTEN: = PropGet [[merged]] key="length"

export function both(x: any): any {
  if (typeof x === "string") return x.length;
  return x.size;
}

export function meets(x: any, log: any): any {
  if (x != null) log(x);
  return x;
}

export function twice(x: any): any {
  if (typeof x === "string") return 0;
  if (typeof x === "number") return x + 1;
  return x;
}

export function unread(x: any): any {
  if (typeof x === "string") return 1;
  return 2;
}

export function written(x: any): any {
  if (typeof x === "string") x = [x];
  return x.length;
}
