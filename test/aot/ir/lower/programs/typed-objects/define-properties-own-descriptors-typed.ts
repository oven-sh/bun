// RUN: lower
// OPTIONS: builtin-modules

// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) in typed code, where the result of the inner call has an object type: generic helpers, annotated and inferred results, typed literals and class instances as source and target, and the errors of either call.
const lines: string[] = [];
function show(label: string, run: () => unknown): void { try { lines.push(label + ": " + String(run())); } catch (error) { lines.push(label + ": " + (error as Error).constructor.name); } }
function whole(object: object): string { return Reflect.ownKeys(object).map(key => { const d = Object.getOwnPropertyDescriptor(object, key)!; return String(key) + ("value" in d ? "=" + (typeof d.value === "function" ? "function" : String(d.value)) : "(" + (d.get ? "get" : "") + (d.set ? "set" : "") + ")") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(" "); }
function merge<T extends object, U extends object>(target: T, source: U): T & U { return Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) as T & U; }
function mergeOntoCopy<T extends object, U extends object>(base: T, extra: U): T & U { return Object.defineProperties({ ...base }, Object.getOwnPropertyDescriptors(extra)) as T & U; }
function mergeAnnotated(target: { a: number }, source: { b: string }): { a: number } { const merged: { a: number } = Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); return merged; }
function mergeKept(target: object, source: { b: string }): string { const descriptors = Object.getOwnPropertyDescriptors(source); const merged = Object.defineProperties(target, descriptors); return whole(merged) + " | " + Object.keys(descriptors).join(); }
function mergeNullable(target: object, source: object | undefined): object { return Object.defineProperties(target, Object.getOwnPropertyDescriptors(source as object)); }
interface Tool { name: string; level: number; readonly label: string }
class Point { x = 1; y = 2; get sum(): number { return this.x + this.y; } }
const defaults = { enabled: true, level: 1, describe(): string { return "default"; } };
show("plain onto plain", () => whole(merge({ a: 1 }, { b: "two", c: 3 })));
show("a getter is kept", () => { let ran = 0; const made = merge({ a: 1 }, { get late(): number { ran++; return 7; } }); const before = ran; return whole(made) + " " + before + " " + made.late + " " + ran; });
show("onto a copy", () => { const tool = mergeOntoCopy(defaults, { name: "first", level: 2, get label(): string { return this.name + ":" + this.level; } }); const typed: Tool = tool; return whole(tool) + " " + typed.label + " " + tool.describe() + " " + defaults.level; });
show("annotated", () => whole(mergeAnnotated({ a: 1 }, { b: "two" })));
show("the descriptors are kept", () => mergeKept({ a: 1 }, { b: "two" }));
show("an instance as source", () => whole(merge({ z: 0 }, new Point())));
show("an instance as target", () => { const point = merge(new Point(), { z: 3, get double(): number { return 6; } }); return whole(point) + " " + point.sum + " " + point.double; });
show("a typed literal as target", () => { const target: { a: number; b?: string } = { a: 1 }; const made = merge(target, { b: "two" }); return whole(made) + " " + target.b; });
show("replaces what is there", () => whole(merge({ a: 1, b: 2 }, { a: "new", get b(): string { return "got"; } })));
show("symbols last", () => { const key = Symbol("key"); return whole(merge({}, { [key]: 1, a: 2 })); });
show("a frozen source", () => whole(merge({}, Object.freeze({ a: 1, b: 2 }))));
show("a frozen target", () => whole(merge(Object.freeze({ a: 1 }), { b: 2 })));
show("an array as source", () => whole(mergeNullable({}, [1, 2])));
show("undefined as source", () => whole(mergeNullable({}, undefined)));
show("many", () => { let sum = 0; for (let i = 0; i < 2000; i++) { const made = mergeOntoCopy(defaults, { name: "n", level: i, get twice(): number { return this.level * 2; } }); sum += made.level + made.twice + Object.keys(made).length; } return sum; });
console.log(lines.join("\n"));

// GENERATED: whole mergeOntoCopy Point sum describe late twice
// CHECK-LABEL: function {{*}}name="whole"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="map" calleeName="map"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = PropGet v8 key="join"
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mergeOntoCopy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_6]]}, {type=undefined|null|[[L_7]] site=[[w_8]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]], v1: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=ObjectDefineProperties
// CHECK-NEXT: v3 = CopyObject v0
// CHECK-NEXT: v4 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v5 = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary [isNotReadFromHolder]
// CHECK-NEXT: v6 = Call v5, -, v1
// CHECK-NEXT: v7 = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: v8 = Call v7, -, v3, v6, v1 calleeName="Object.defineProperties"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_5]] site=[[w_9]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_11]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_10]] site=[[w_12]]} results=[{type=number site=[[w_13]]}] {
// CHECK-NEXT: b0(v0: [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="default"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_16]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number site=[[w_17]]}] {
// CHECK-NEXT: b0(v0: env [[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_16]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="ran"
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_18]]}
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_16]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="ran"
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_16]]
// CHECK-NEXT: v8 = Integer integer=7
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_19]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_20]]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="level"
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Mul v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_19]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
