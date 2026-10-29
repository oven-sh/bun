// RUN: lower
// OPTIONS: builtin-modules

// A class with `declare` fields IS extended by mixins whose accessors have names computed at run time, and one of the names is a field's. A store in the class's own method then runs the setter, or throws where there is only a getter, and makes no property of the object; a read runs the getter. Objects of the class itself are not touched by that.
const log: string[] = [];
function withBoth<T extends new (...args: any[]) => any>(Base: T, name: string) {
  return class extends Base {
    get [name]() { log.push("get"); return -1; }
    set [name](value: number) { log.push("set " + value); }
  };
}
function withGetter<T extends new (...args: any[]) => any>(Base: T, name: string) {
  return class extends Base {
    get [name]() { return -2; }
  };
}
function withMethod<T extends new (...args: any[]) => any>(Base: T, name: string) {
  return class extends Base {
    [name]() { return -3; }
  };
}
class Holder {
  declare shadowed: number;
  declare own: number;
  fill(value: number): void { this.shadowed = value; this.own = value + 1; }
  fillOwnFirst(value: number): void { this.own = value + 1; this.shadowed = value; }
  read(): string { return (typeof this.shadowed === "function" ? "a function" : String(this.shadowed)) + " " + String(this.own); }
  has(): string { return ("shadowed" in this) + " " + Object.hasOwn(this, "shadowed") + " " + ("own" in this) + " " + Object.hasOwn(this, "own"); }
}
class Below extends Holder {
  declare further: string;
  fillAll(value: number): void { this.fill(value); this.further = "f"; }
}
const name = ["shad", "owed"].join("");
function show(what: string, made: Holder, fill: (made: Holder) => void): void {
  let thrown = "";
  console.log(what + ", empty: " + made.read() + " | " + made.has() + " | " + Object.keys(made).join());
  try { fill(made); } catch (error) { thrown = (error as Error).name; }
  console.log(what + ": " + made.read() + " | " + made.has() + " | " + Object.keys(made).join() + " | " + JSON.stringify(made) + " | " + log.join() + " | " + thrown);
  log.length = 0;
}
const classes: [string, new () => Holder][] = [
  ["the class itself", Holder],
  ["accessor pair", withBoth(Holder, name)],
  ["getter only", withGetter(Holder, name)],
  ["method", withMethod(Holder, name)],
  ["another name", withBoth(Holder, "other")],
  ["below", Below],
  ["accessor pair over the subclass", withBoth(Below, name)],
  ["two mixins", withBoth(withGetter(Holder, "other"), name)],
];
for (const [what, made] of classes) {
  show(what, new made(), made => made.fill(5));
  show(what + ", the other field first", new made(), made => made.fillOwnFirst(7));
}
show("all three", new (withBoth(Below, name))(), made => (made as Below).fillAll(9));
let total = 0;
for (let i = 0; i < 300; i++) {
  const made = new (classes[i % classes.length]![1])();
  try { made.fill(i); } catch {}
  total += Object.keys(made).length;
}
console.log(total, log.length);

// GENERATED: withBoth withGetter Holder fillOwnFirst has Below
// CHECK-LABEL: function {{*}}name="withBoth"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}, {type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_4]] site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ResolveHeritage v0
// CHECK-NEXT: v3 = NewClosure function=[[f_6]]
// CHECK-NEXT: v4 = NewClass v3, v0, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = ToPropertyKey v1
// CHECK-NEXT: v6 = NewClosure function=[[f_8]]
// CHECK-NEXT: SetFunctionName v6, v5 methodKind=Getter
// CHECK-NEXT: DefineMethod v4, v6, v5 layout=[[L_7]] methodKind=Getter
// CHECK-NEXT: v9 = ToPropertyKey v1
// CHECK-NEXT: v10 = NewClosure function=[[f_9]]
// CHECK-NEXT: SetFunctionName v10, v9 methodKind=Setter
// CHECK-NEXT: DefineMethod v4, v10, v9 layout=[[L_7]] methodKind=Setter index=1
// CHECK-NEXT: v13 = FinishClass v4 layout=[[L_7]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_4]] site=[[w_5]]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="withGetter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] site=[[w_11]]}, {type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_13]] site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ResolveHeritage v0
// CHECK-NEXT: v3 = NewClosure function=[[f_15]]
// CHECK-NEXT: v4 = NewClass v3, v0, v2 layout=[[L_16]]
// CHECK-NEXT: v5 = ToPropertyKey v1
// CHECK-NEXT: v6 = NewClosure function=[[f_17]]
// CHECK-NEXT: SetFunctionName v6, v5 methodKind=Getter
// CHECK-NEXT: DefineMethod v4, v6, v5 layout=[[L_16]] methodKind=Getter
// CHECK-NEXT: v9 = FinishClass v4 layout=[[L_16]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_13]] site=[[w_14]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_19]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_19]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_19]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fillOwnFirst"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_19]] site=[[w_20]]} parameters=[{type=number site=[[w_21]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_19]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_22]]}
// CHECK-NEXT: PropSet v0, v4 key="own"
// CHECK-NEXT: v6 = Convert v1 declared={type=number site=[[w_23]]}
// CHECK-NEXT: PropSet v0, v6 key="shadowed"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_19]] site=[[w_24]]} results=[{type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_19]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropHas v0 key="shadowed"
// CHECK-NEXT: v2 = String string=" "
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v6 = String string="shadowed"
// CHECK-NEXT: v7 = Call v5, v4, v0, v6 calleeName="Object.hasOwn"
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_26]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Add v3, v8
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = PropHas v0 key="own"
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = String string=" "
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = Builtin builtin=Object
// CHECK-NEXT: v17 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v18 = String string="own"
// CHECK-NEXT: v19 = Call v17, v16, v0, v18 calleeName="Object.hasOwn"
// CHECK-NEXT: v20 = Convert v19 declared={type=boolean site=[[w_27]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = Add v15, v20
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Below"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_28]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_29]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_29]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
