// RUN: link
// CHECK: expectedresult [[expected]] type=[[chain]] layouts={{*}}[[row]], [[chain]]]
// CHECK: layout [[row]] module={{*}}fields=[{key="id"
// CHECK: layout [[chain]] module={{*}}fields=[{key="and"
// CHECK: function {{*}}name="fluent"
// CHECK: = Call {{*}}expectedResult=[[expected]]
// CHECK: Return

// Whoever creates the result creates what its fields hold: a `Chain<Row>` and a `Row`. Every method returns another
// instantiation of `Chain`, which has the same methods again, so what the signatures name has no end.
interface Row {
  id: number;
}

interface Chain<T> {
  value: T;
  optional(): Chain<T | undefined>;
  array(): Chain<T[]>;
  and<U>(other: Chain<U>): Chain<[T, U]>;
  map: <U>(change: (value: T) => U) => Chain<U | T>;
}

declare function chain<T>(): Chain<T>;

export function fluent() {
  return chain<Row>();
}
