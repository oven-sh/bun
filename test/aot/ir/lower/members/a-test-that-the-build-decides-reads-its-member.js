// RUN: lower
// The build knows what each of these answers. `bun run` works it out and reads the member, which its holder lists from its first read on:
// the read stays, with a value that nobody takes. The engine drops it where nothing can list the keys of the holder.
// CHECK-LABEL: function {{*}}name="behindAnother"
// CHECK: = Builtin builtin=ReflectHas
// Of `a === b` whose value nothing takes, `bun run` leaves what does something.
// CHECK-LABEL: function {{*}}name="besideCall"
// CHECK-NOT: = Builtin builtin=Reflect
// CHECK-LABEL: function {{*}}name="compared"
// CHECK: = Builtin builtin=StringRaw
// CHECK-NEXT: = Boolean
// CHECK-LABEL: function {{*}}name="leftOfComma"
// CHECK: = Builtin builtin=StringRaw
// Nothing takes these values, and each member is one that `bun run` does not read there.
// CHECK-LABEL: function {{*}}name="leftOut"
// CHECK-NOT: = Builtin builtin=Reflect
// CHECK-LABEL: function {{*}}name="lookedFor"
// CHECK: = Builtin builtin=ObjectFreeze
// CHECK-NEXT: = Boolean
// CHECK-LABEL: function {{*}}name="negated"
// CHECK: = Builtin builtin=ReflectSet
// CHECK-LABEL: function {{*}}name="picked"
// CHECK: = Builtin builtin=SymbolKeyFor
// CHECK-LABEL: function {{*}}name="tested"
// CHECK: = Builtin builtin=ReflectConstruct
// `bun run` prints the update of a loop as it is written.
// CHECK-LABEL: function {{*}}name="updated"
// CHECK: = Builtin builtin=ReflectGet
const one = 1;
export function behindAnother() {
  if (one && Reflect.has) return 1;
  else return 2;
}
export function besideCall(call) {
  Reflect.get === call();
  typeof Reflect.has !== call();
}
export function compared() {
  return String.raw === undefined;
}
export function leftOfComma() {
  return (String.raw, 1);
}
export function leftOut() {
  Reflect.deleteProperty;
  if (Reflect.has) {}
  if (Reflect.get);
  if (Reflect.set) {} else {}
  void Reflect.apply;
  typeof Reflect.has;
  Reflect.get === 1;
  Reflect.set && 1;
  Reflect.ownKeys ? 1 : 2;
  if (!Reflect.apply) {}
  if (typeof Reflect.defineProperty === "function" && Reflect.getPrototypeOf) {}
  return (Reflect.construct, 1);
}
export function lookedFor() {
  return "freeze" in Object;
}
export function negated(count) {
  if (!Reflect.set) count--;
  return count;
}
export function picked() {
  return Symbol.keyFor ? 1 : 2;
}
export function tested(count) {
  if (Reflect.construct) count++;
  return count;
}
export function updated(count) {
  for (; count > 0; Reflect.get) count--;
  return count;
}
