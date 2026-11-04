// RUN: lower
// OPTIONS: builtin-modules

// `name in o` and Object.hasOwn(o, name) where o inherits from an object with a type, straight or through others: the name written, held in a variable, put together anew; fields that are always there, optional ones, methods, accessors, names of the prototype above, names nobody has. Each question is asked often, then something changes above or below, and it is asked again.
interface Step { op: string; weight: number; inner: { a: number }; run(this: any, x: number): number; note?: string; size?: number; readonly twice: number }
const upper: any = { far: 1, get reckoned() { return 2; } };
function makeStep(op: string, weight: number): Step { return { op, weight, inner: { a: weight }, run(this: any, x: number): number { return x + this.weight; }, get twice(): number { return this.weight * 2; } }; }
const steps: Step[] = [makeStep("add", 1.5), makeStep("sub", 2.5), makeStep("mul", 3.5)];
let typedSum = 0;
for (const step of steps) typedSum += step.weight + step.op.length + step.inner.a + step.run(1) + (step.note ?? "").length + (step.size ?? 0) + step.twice;
console.log(typedSum);
const mark = Symbol("mark");
const names = ["op", "weight", "inner", "run", "twice", "note", "size", "missing", "toString", "value", "later", "far", "reckoned"];
const written: Record<string, (o: any) => boolean> = {
  op: o => "op" in o, weight: o => "weight" in o, inner: o => "inner" in o, run: o => "run" in o, twice: o => "twice" in o, note: o => "note" in o, size: o => "size" in o,
  missing: o => "missing" in o, toString: (o: any) => "toString" in o, value: o => "value" in o, later: o => "later" in o, far: o => "far" in o, reckoned: o => "reckoned" in o,
};
const ownWritten: Record<string, (o: any) => boolean> = {
  op: o => Object.hasOwn(o, "op"), weight: o => Object.hasOwn(o, "weight"), inner: o => Object.hasOwn(o, "inner"), run: o => Object.hasOwn(o, "run"), twice: o => Object.hasOwn(o, "twice"), note: o => Object.hasOwn(o, "note"), size: o => Object.hasOwn(o, "size"),
  missing: o => Object.hasOwn(o, "missing"), toString: (o: any) => Object.hasOwn(o, "toString"), value: o => Object.hasOwn(o, "value"), later: o => Object.hasOwn(o, "later"), far: o => Object.hasOwn(o, "far"), reckoned: o => Object.hasOwn(o, "reckoned"),
};
const has = function (o: any, key: any): any { return key in o; };
const owns = function (o: any, key: any): any { return Object.hasOwn(o, key); };
const anew = (name: string): string => name.slice(0, 1) + name.slice(1);
const digit = (...answers: boolean[]): string => answers.reduce((sum, answer, i) => sum + (answer ? 1 << i : 0), 0).toString(32);
function all(o: any): string {
  const said = new Set<string>();
  for (let round = 0; round < 40; round++) said.add(names.map(name => digit(has(o, name), written[name](o), has(o, anew(name)), owns(o, name), ownWritten[name](o))).join("") + digit(has(o, mark), owns(o, mark)));
  return [...said].join("!");
}
const hide = (x: any): any => x;
const base: any = hide(steps[0]);
const heir: any = Object.create(base);
heir.value = 1;
const below: any = Object.create(heir);
const deeper: any = Object.create(below);
class Kind { tag = 1; }
const instance: any = new Kind();
const family: [string, any][] = [["base", base], ["heir", heir], ["below", below], ["deeper", deeper]];
const tell = (what: string): void => { console.log(what + ": " + family.map(([who, o]) => who + " " + all(o)).join(" | ")); };
tell("at first");
base.note = "now"; tell("an optional field is set");
delete base.note; tell("and deleted");
base.size = 3; tell("another is set");
base.size = "three"; tell("to a value of another kind");
delete base.size; tell("and deleted");
base.later = 1; tell("a name beyond the type");
delete base.later; tell("and deleted");
base[mark] = 1; tell("a symbol");
delete base[mark]; tell("and deleted");
heir.missing = 1; tell("the heir gets a name itself");
delete heir.missing; tell("and loses it");
below.missing = undefined; tell("the one below gets it, undefined");
delete below.missing; tell("and loses it");
Object.defineProperty(heir, "note", { get() { return 1; }, configurable: true }); tell("the heir gets a getter for an optional field above");
delete heir.note; tell("and loses it");
delete base.run; tell("the method is deleted");
base.run = function () { return 0; }; tell("and stored again");
delete base.twice; tell("the accessor is deleted");
Object.defineProperty(base, "twice", { value: 4, configurable: true, writable: true, enumerable: true }); tell("and defined as a value");
delete base.op; tell("a field that is always there is deleted");
base.op = "again"; tell("and stored again");
Object.setPrototypeOf(base, upper); tell("the typed object gets a prototype with names");
upper.missing = 1; tell("which gains a name");
delete upper.missing; tell("and loses it");
delete upper.far; tell("and another");
delete upper.reckoned; tell("and its getter");
Object.setPrototypeOf(base, Object.prototype); tell("and the old prototype again");
Object.setPrototypeOf(below, steps[1]); tell("the one below moves under another typed object");
Object.setPrototypeOf(below, instance); tell("under an instance of a class");
Object.setPrototypeOf(below, null); tell("under nothing");
Object.setPrototypeOf(below, heir); tell("and back");
Object.freeze(base); tell("the typed object is frozen");
Object.preventExtensions(heir); tell("the heir takes no more");
const many: any[] = [];
for (let i = 0; i < 60; i++) { const o = Object.create(i % 3 === 0 ? steps[1] : i % 3 === 1 ? steps[2] : heir); o["k" + (i % 7)] = i; many.push(o); }
let count = 0;
for (let round = 0; round < 30; round++) for (const o of many) count += (has(o, "op") ? 1 : 0) + (written.run(o) ? 2 : 0) + (has(o, "k3") ? 4 : 0) + (has(o, anew("note")) ? 8 : 0) + (written.twice(o) ? 16 : 0) + (has(o, "nowhere") ? 32 : 0);
console.log(count);

// GENERATED: all Kind owns digit
// CHECK-LABEL: function {{*}}name="all"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=Set
// CHECK-NEXT: v2 = Construct v1 calleeName="Set"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Set<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v5)
// CHECK-NEXT: b1(v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Integer integer=40
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = PropGet v3 key="add"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="names"
// CHECK-NEXT: v13 = PropGet v12 key="map"
// CHECK-NEXT: v14 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="map" calleeName="names.map"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = String string=""
// CHECK-NEXT: v19 = Call v17, v16, v18 calleeKey="join" calleeName="join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="digit"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="has"
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="mark"
// CHECK-NEXT: v27 = Call v24, -, v0, v26 calleeName="has"
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="owns"
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="mark"
// CHECK-NEXT: v32 = Call v29, -, v0, v31 calleeName="owns"
// CHECK-NEXT: v33 = Call v22, -, v27, v32 calleeName="digit"
// CHECK-NEXT: v34 = Add v20, v33
// CHECK-NEXT: v35 = Call v10, v3, v34 calleeKey="add" calleeName="said.add"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|Set<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v37 = Increment v6
// CHECK-NEXT: v38 = Convert v37 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v38)
// CHECK-NEXT: b3():
// CHECK-NEXT: v39 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v39, v3
// CHECK-NEXT: v41 = PropGet v39 key="join"
// CHECK-NEXT: v42 = String string="!"
// CHECK-NEXT: v43 = Call v41, v39, v42 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v43 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Kind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="owns"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v4 = Call v3, v2, v0, v1 calleeName="Object.hasOwn"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=boolean}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="digit"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array<boolean> flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: Array<boolean>):
// CHECK-NEXT: v1 = PropGet v0 key="reduce"
// CHECK-NEXT: v2 = NewClosure function=[[f_9]]
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Call v1, v0, v2, v3 calleeKey="reduce" calleeName="answers.reduce"
// CHECK-NEXT: v5 = Convert v4 declared={type=number} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = PropGet v5 key="toString"
// CHECK-NEXT: v7 = Integer integer=32
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeKey="toString" calleeName="toString"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
