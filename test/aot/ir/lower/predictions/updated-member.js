// RUN: lower
// Nothing is written of a member, so what an update reads goes into the operator as it is.
// CHECK-LABEL: function {{*}}name="added"
// CHECK: [[addedRead]] = PropGet {{*}}key="total"
// CHECK-NOT: Convert
// CHECK: [[addedNew]] = Add [[addedRead]],
// CHECK-NEXT: PropSet {{*}}, [[addedNew]] key="total"
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: [[computedRead]] = ElemGet
// CHECK-NEXT: = Increment [[computedRead]]
// CHECK-LABEL: function {{*}}name="logical"
// CHECK: [[logicalRead]] = PropGet {{*}}key="count"
// CHECK-NOT: Convert [[logicalRead]]
// CHECK-LABEL: function {{*}}name="masked"
// CHECK: [[maskedRead]] = PropGet {{*}}key="flags"
// CHECK-NOT: Convert
// CHECK: = BitOr [[maskedRead]],
// CHECK-LABEL: function {{*}}name="postfix"
// CHECK: [[postfixRead]] = PropGet {{*}}key="count"
// CHECK-NEXT: [[postfixNew]] = Increment [[postfixRead]]
// CHECK-NEXT: PropSet {{*}}, [[postfixNew]] key="count"
// CHECK-LABEL: function {{*}}name="postfixValue"
// CHECK: [[valueRead]] = PropGet {{*}}key="count"
// CHECK-NEXT: [[valueNumeric]] = ToNumeric [[valueRead]]
// CHECK-NEXT: [[valueNew]] = Decrement [[valueNumeric]]
// CHECK-NEXT: PropSet {{*}}, [[valueNew]] key="count"
// CHECK-LABEL: function {{*}}name="shifted"
// CHECK: [[mixedRead]] = PropGet {{*}}key="hash"
// CHECK-NEXT: = BitXor [[mixedRead]],
// CHECK: [[shiftedRead]] = PropGet {{*}}key="hash"
// CHECK-NOT: Convert
// CHECK: = URShift [[shiftedRead]],
// CHECK-LABEL: function {{*}}name="shiftedWrittenOut"
// CHECK: [[writtenOutRead]] = PropGet {{*}}key="hash"
// CHECK-NEXT: = BitXor [[writtenOutRead]],
// CHECK-LABEL: function {{*}}name="unknown"
// CHECK: [[unknownRead]] = PropGet {{*}}key="total"
// CHECK-NEXT: = Add [[unknownRead]],

export function added(account) {
  account.total += 2;
}

export function computed(at) {
  const counts = [0, 0, 0];
  counts[at]++;
  return counts;
}

export function logical(counter) {
  counter.count ??= 0;
}

export function masked(state) {
  state.flags |= 4;
}

export function postfix(counter) {
  counter.count++;
}

export function postfixValue(counter) {
  return counter.count--;
}

export function shifted(state, bits) {
  state.hash ^= bits;
  state.hash >>>= 0;
}

export function shiftedWrittenOut(state, bits) {
  state.hash = (state.hash ^ bits) >>> 0;
}

export function unknown(account, by) {
  account.total += by;
}
