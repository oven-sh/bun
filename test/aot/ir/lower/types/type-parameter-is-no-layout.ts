// RUN: link
// CHECK-NOT: IsTypeParameter
// CHECK: layout {{*}}kind=Instance name="Box" {{*}}fields=[{key="value" declared={type=anything}
// CHECK-NOT: IsTypeParameter
// CHECK: function {{*}}name="Box" module={{*}}parameters=[{type=anything}]
// CHECK-NOT: IsTypeParameter

// RUN(PAIR): lower
// PAIR-LABEL: function {{*}}name="pair"
// PAIR: parameters=[{type=anything}, {type=anything}] results=[{type=anything}]

// Inside the function or the class that declares it a type parameter is no type of its own. Without a bound it says nothing: a field, a parameter and a result that are written `T` take every value, and what a call puts in the place of `T` is claimed at the call (../calls/generic-call-result.ts). With a bound it has the type of the bound (type-parameter-predicts-constraint.ts).
export class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

export function pair<A, B>(first: A, second: B): A {
  return first;
}
