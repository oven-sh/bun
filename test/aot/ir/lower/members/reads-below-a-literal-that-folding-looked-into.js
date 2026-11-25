// RUN: lower
// Folding looks into a text, a list and a call of a method of the language, and has the answer of each of these. `bun run` evaluates the index, the elements and the receiver,
// and each reads a member that its holder lists from its first read on: the reads stay.
// CHECK-LABEL: function {{*}}name="indexed"
// CHECK: = Builtin builtin=ReflectHas
// CHECK-LABEL: function {{*}}name="joined"
// CHECK: = Builtin builtin=StringRaw
// CHECK-LABEL: function {{*}}name="listed"
// CHECK: = Builtin builtin=StringRaw
export function indexed() {
  return "abc"[Reflect.has ? 0 : 1] === "a";
}
export function joined() {
  return [typeof String.raw, "b"].join();
}
export function listed() {
  return [typeof String.raw][0] === "function";
}
