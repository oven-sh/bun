// RUN: lower
// CHECK-LABEL: function {{*}}name="take"
// CHECK: [[copy]] = NewObject layout=[[layout]] @
// CHECK-NEXT: CopyDataProperties [[copy]], {{*}}excludedKeys=["a"]
// CHECK-NEXT: [[finished]] = FinishObject [[copy]]
// CHECK-NEXT: [[rest]] = Convert [[finished]] declared={type=undefined|null|[[layout]]
// CHECK: = PropGet [[rest]] key="b"
// CHECK: Return

// RUN(FIELDS): link
// FIELDS: layout {{*}}fields=[{key="b" {{*}}, {key="c" 

// RUN(UNTYPED): lower
// UNTYPED-LABEL: function {{*}}name="takeAnything"
// UNTYPED: [[copy]] = NewObject layout=[[empty]] @
// UNTYPED-NEXT: CopyDataProperties [[copy]],
// UNTYPED-NEXT: [[finished]] = FinishObject [[copy]]
// UNTYPED-NOT: Convert [[finished]] declared={type=undefined|null|L
// UNTYPED: Return

// The object that `...rest` creates is converted to the type of `rest`. Only an object with the layout of that type passes, so the
// copy is allocated with it.
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
