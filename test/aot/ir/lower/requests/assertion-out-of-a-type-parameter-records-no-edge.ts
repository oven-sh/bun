// RUN: link
// `value as Flow` with `value: S` says that this one value is a Flow. It does not say that whatever is passed for S is one. Every layout that is passed for S lies below
// the record of S, so an edge from that record up to Flow would put them all into the set of Flow: Point, which has none of its names.
// The record of S is the one that Point lies below. It has no `supertypes=` of its own: its flags follow its number.
// CHECK: layout {{*}}name="Point" {{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[parameter]]]
// CHECK: layout [[parameter]] flags=[IsTypeParameter

// RUN(INTO): link
// The other way round stands: `made as T` says that this object passes for T, so its layout goes below the record of T.
// INTO: layout {{*}}name="Made" {{*}}supertypes=[
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
