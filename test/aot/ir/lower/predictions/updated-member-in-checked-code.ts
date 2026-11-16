// RUN: lower
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK: [[assertedRead]] = PropGet {{*}}key="count"
// CHECK-NEXT: [[assertedOld]] = Convert [[assertedRead]] declared={type=number} illTypedCause=Assertion @
// CHECK-NEXT: [[assertedNew]] = Increment [[assertedOld]]
// CHECK-NEXT: PropSet {{*}}, [[assertedNew]] key="count"
// CHECK-LABEL: function {{*}}name="declared"
// CHECK: [[declaredRead]] = PropGet {{*}}key="steps"
// CHECK-NEXT: [[declaredNew]] = Increment [[declaredRead]]
// CHECK-NEXT: PropSet {{*}}, [[declaredNew]] key="steps"
// CHECK-LABEL: function {{*}}name="narrowed"
// CHECK: Branch
// CHECK: [[narrowedRead]] = PropGet {{*}}key="count"
// CHECK-NEXT: [[narrowedNew]] = Increment [[narrowedRead]]
// CHECK-NEXT: PropSet {{*}}, [[narrowedNew]] key="count"
// CHECK-LABEL: function {{*}}name="narrowedSum"
// CHECK: Branch
// CHECK: [[sumRead]] = PropGet {{*}}key="count"
// CHECK-NOT: Convert
// CHECK: [[sum]] = Add [[sumRead]],
// CHECK-NEXT: PropSet {{*}}, [[sum]] key="count"

// An update converts what it reads only where a cast is written: nobody asks what a test narrows the member to. What it stores is not converted: the layout says what the field is declared to hold.

export function asserted(counter: { count: number | string }) {
  (counter.count as number)++;
}

// Object types with the same names have one layout, whose slot holds what any of them says: this one has a name of its own.
export function declared(counter: { steps: number }) {
  counter.steps++;
}

export function narrowed(counter: { count: number | string }) {
  if (typeof counter.count === "number") counter.count++;
}

export function narrowedSum(counter: { count: number | string }) {
  if (typeof counter.count === "number") counter.count += 2;
}
