// RUN: lower
// CHECK-LABEL: function {{*}}name="take"
// CHECK: [[copy]] = NewObject layout=[[layout]] @
// CHECK-NEXT: CopyDataProperties [[copy]], {{*}}excludedKeys=["a"]
// CHECK-NEXT: [[rest]] = FinishObject [[copy]]
// CHECK-NEXT: = PropGet [[rest]] key="b"
// CHECK: Return

// RUN(FIELDS): link
// FIELDS: layout [[layout]] {{*}}fields=[{key="b" {{*}}, {key="c"
// FIELDS: function {{*}}name="take"
// FIELDS: = NewObject layout=[[layout]] @
// FIELDS: function {{*}}name="takeAnything"

// RUN(UNTYPED): lower
// UNTYPED-LABEL: function {{*}}name="takeAnything"
// UNTYPED-NOT: = NewObject
// UNTYPED: [[finished]] = CopyObject {{*}}excludedKeys=["a"]
// UNTYPED-NOT: Convert [[finished]] declared={type=undefined|null|L
// UNTYPED: Return

// The object that `...rest` creates is allocated with the layout of the type of `rest`, so `rest.b` reads a field of it. The binding has
// no annotation, so nothing converts the copy.
interface Props {
  a: number;
  b: string;
  c: boolean;
}

export function take(props: Props): string {
  const { a, ...rest } = props;
  return rest.b + a;
}

export function takeAnything(props: any): unknown {
  const { a, ...rest } = props;
  return [a, rest];
}
