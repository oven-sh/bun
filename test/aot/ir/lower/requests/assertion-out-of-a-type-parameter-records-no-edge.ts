// RUN: link
// `value as Flow` with `value: S` says that this one value is a Flow. It does not say that whatever is passed for S is one: Point, which has none of its names, stays out of the set of Flow.
// CHECK-NOT: layout {{*}}fields=[{key="x"{{*}}{key="y"{{*}}supertypes=

// RUN(INTO): link
// `made as T` enters a position that takes every value, so Made goes below nothing. `make` is in the program, so what `make<Made>()` answers is claimed to be nothing: Made goes along as a guess, because the answer is read like an object.
// INTO-NOT: layout {{*}}fields=[{key="made"{{*}}supertypes=
// INTO: [[answer]] = Call {{*}}calleeName="make"
// INTO-NEXT: [[expected]] = Convert [[answer]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// INTO-NEXT: = PropGet [[expected]] key="made"
interface Flow {
  state: string;
  tries: number;
}
interface Point {
  x: number;
  y: number;
}
interface Made {
  made: number;
}
function stateOf<S>(value: S): string {
  return (value as Flow).state;
}
function make<T>(): T {
  const made: Made = { made: 1 };
  return made as T;
}
const flow: Flow = { state: "idle", tries: 0 };
const point: Point = { x: 1, y: 2 };
export const results = [stateOf(flow), stateOf(point), make<Made>().made];
