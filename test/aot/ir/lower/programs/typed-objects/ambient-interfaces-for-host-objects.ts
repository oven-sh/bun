// RUN: lower
// OPTIONS: builtin-modules

// Interfaces written under `declare global` describe host objects. A host object that does not have a declared member passes every place of that type, and the member reads undefined, as in plain Bun.
declare global {
  namespace NodeJS { interface ProcessEnv { APP_REQUIRED_KEY: string; APP_OPTIONAL_KEY?: string } }
  interface HostThing { id: number; label: string }
  var hostThing: HostThing;
}
(globalThis as any).hostThing = { id: 1 };
(globalThis as any).process ??= { env: { HOME: "/home" } };
const copy: NodeJS.ProcessEnv = { ...process.env };
const same: NodeJS.ProcessEnv = process.env;
function keysOf(env: NodeJS.ProcessEnv): number { return Object.keys(env).length; }
console.log(typeof copy.APP_REQUIRED_KEY, typeof same.APP_REQUIRED_KEY, copy.APP_OPTIONAL_KEY, keysOf(copy) === keysOf(process.env), keysOf({ ...process.env, EXTRA: "1" }) - keysOf(copy));
const thing: HostThing = hostThing;
const spread: HostThing = { ...hostThing };
const made: HostThing = { id: 2, label: "made" };
function labelOf(t: HostThing): string { return String(t.label); }
console.log(thing.id, labelOf(thing), labelOf(spread), labelOf(made), thing === hostThing, JSON.stringify(spread), JSON.stringify(made));
export {};

// GENERATED: keysOf labelOf
// CHECK-LABEL: function {{*}}name="keysOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="labelOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = PropGet v0 key="label"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
