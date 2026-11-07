// RUN: link
// The parser of the engine begins each link of the callee of a `new` at the first `new` in front of it. So a read that fails there is quoted from that `new`
// up to its own end, without the arguments, and a `new` behind a `new` from the first of the two.
export function probe(holder, key) {
  return new holder.a.Maker(key);
}
export function twice(holder, key) {
  return new new holder.Maker()(key);
}
// CHECK: textOfQuotes="new holder.a.Maker(key)new new holder.Maker()(key)"
// RUN(OBJECT): link
// OBJECT: {position={{*}} end=12}
// RUN(CALLEE): link
// CALLEE: {position={{*}} end=18}
// RUN(WHOLE): link
// WHOLE: {position={{*}} end=23}
// RUN(SECOND): link
// SECOND: {position={{*}} start=23 end=43}
// RUN(INNER): link
// INNER: {position={{*}} start=23 end=45}
// RUN(OUTER): link
// OUTER: {position={{*}} start=23 end=50}
// RUN(NOWHERE): link
// NOWHERE-NOT: start=4 end
// NOWHERE-NOT: start=27 end
