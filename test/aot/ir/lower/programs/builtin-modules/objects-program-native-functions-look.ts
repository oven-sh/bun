// RUN: lower
// OPTIONS: builtin-modules

// Objects of the program that a native function only looks at or converts: a validated build has to find the row of each.
class Delay { valueOf() { return 1000; } }
class Keyed extends Map<number, number> {}
class Listed extends Set<number> {}
const say = (...values: unknown[]) => console.log(...values);
say(typeof AbortSignal.timeout(new Delay() as unknown as number).aborted, (Keyed as any)[Symbol.species] === Keyed, (Listed as any)[Symbol.species] === Listed);
const registry = new FinalizationRegistry((held: Delay) => say(held));
registry.register(new Delay(), new Delay()); say(registry.unregister(new Delay()));
const holder = { get made() { return new Delay(); }, kept: new Delay() };
say((holder as any).__lookupGetter__("made").call(holder) instanceof Delay, (holder as any).__lookupSetter__("made"), (holder as any).__lookupGetter__("kept"));
say(Object.getOwnPropertyDescriptor(holder, "kept")!.value instanceof Delay, Error.stackTraceLimit + 0 > 0, new TypeError("x").name.length, TypeError.prototype.message.length);
say(new WebAssembly.Global({ value: "externref", mutable: true }, holder).value === holder, navigator.hardwareConcurrency > 0, navigator.userAgent.length > 0, navigator.platform.length > 0);
say(Bun.enableANSIColors === true || Bun.enableANSIColors === false, Bun.dns.ADDRCONFIG + Bun.dns.ALL + Bun.dns.V4MAPPED > 0, typeof (Bun.dns as any).resolve, require("node:module").builtinModules.includes("fs"));
process.exit(0);

// GENERATED: Delay valueOf Keyed say made
// CHECK-LABEL: function {{*}}name="Delay"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1000
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keyed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy, HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array site=[[w_4]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v6, v0
// CHECK-NEXT: v8 = CallList v5, v3, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsSloppy, IsChecked, HasExplicitName] captures=[{type=[[f_6]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|number|[[L_1]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Construct v0 calleeName="Delay"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|[[L_1]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
