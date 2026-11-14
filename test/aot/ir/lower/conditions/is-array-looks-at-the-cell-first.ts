// `Array.isArray(local)` in a condition: a list passes a look at its cell, and of whatever else the local holds the function is asked, as it is written: the prototype of lists, an instance of a class below and a proxy of a list pass too.
// The arm on which the answer is yes reads what either way has left of the local, the other arm what the look has left.
// RUN: lower
// CHECK-LABEL: function {{*}}name="size"
// CHECK: [[look]] = TypeTest [[x]] testedType=Array @
// CHECK-NEXT: Branch [[look]] -> taken [[isList]](| 0), notTaken [[isOther]](| 0)
// CHECK: [[isList]]([[list]]):
// CHECK-NEXT: Jump -> next [[yes]]([[list]])
// CHECK: [[isOther]]([[rest]]):
// CHECK-NEXT: [[left]] = NarrowByTest [[x]], [[rest]]
// CHECK: = Call {{*}}, [[left]] calleeName="Array.isArray"
// CHECK: Branch {{*}} -> taken [[yes]]([[rest]]),
// CHECK: [[yes]]([[either]]):
// CHECK-NEXT: [[passed]] = NarrowByTest [[x]], [[either]]
// CHECK: = PropGet [[passed]] key="length"
// CHECK: = PropGet [[left]] key="size"

// Of anything but a local the function alone is asked.
// RUN(MEMBER): lower
// MEMBER-LABEL: function {{*}}name="member"
// MEMBER-NOT: TypeTest
// MEMBER: = Call {{*}}calleeName="Array.isArray"
// MEMBER-LABEL: function {{*}}name="value"
// MEMBER-NOT: TypeTest
// MEMBER: = Call {{*}}calleeName="Array.isArray"

export function size(x: any): any {
  if (Array.isArray(x)) return x.length;
  return x.size;
}

export function member(holder: any): any {
  if (Array.isArray(holder.list)) return 1;
  return 2;
}

export function value(x: any): any {
  return Array.isArray(x);
}
