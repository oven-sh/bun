// RUN: lower
// OPTIONS: builtin-modules

// Standard decorators add initializers and run in order.
const seen: string[] = [];

function mark(label: string) {
  seen.push("evaluated " + label);
  return function (target: unknown, context: DecoratorContext): void {
    seen.push("applied " + label + " to " + context.kind + " " + String(context.name) + (context.kind !== "class" && context.static ? " (static)" : ""));
    context.addInitializer(function () {
      seen.push("initializer of " + label);
    });
  };
}

@mark("class one")
@mark("class two")
class Meter {
  @mark("field") amount = (seen.push("the field's own initializer"), 2);
  @mark("static field") static shared = 1;
  @mark("method")
  read(): number {
    return this.amount;
  }
  @mark("static method")
  static make(): Meter {
    return new Meter();
  }
  @mark("getter")
  get twice(): number {
    return this.amount * 2;
  }
  @mark("private method")
  #hidden(): number {
    return 1;
  }
  constructor() {
    seen.push("constructor body " + this.#hidden());
  }
}

console.log("after the definition:");
for (const line of seen) console.log("  " + line);
seen.length = 0;
const made = Meter.make();
console.log("after one construction:");
for (const line of seen) console.log("  " + line);
console.log("members: " + made.amount + " " + made.read() + " " + made.twice + " " + Meter.shared + " keys [" + Object.keys(made).join(" ") + "]");

// GENERATED: mark Meter make twice #hidden
// CHECK-LABEL: function {{*}}name="mark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="seen"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="evaluated "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Meter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_9]]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v6 = Integer integer=4
// CHECK-NEXT: v7 = ElemGet v5, v6
// CHECK-NEXT: v8 = Builtin builtin=CompilerHelpersRunInitializers [isNotReadFromHolder]
// CHECK-NEXT: v9 = Call v8, -, v7, v3
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="seen"
// CHECK-NEXT: v12 = PropGet v11 key="push"
// CHECK-NEXT: v13 = String string="constructor body "
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v15 = PrivateGet v3, v14 layout=[[L_8]]
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v17 = Call v16, v3 calleeName="this.#hidden"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v19 = Add v13, v18
// CHECK-NEXT: v20 = Call v12, v11, v19 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v21 = Convert v20 declared={type=number site=[[w_14]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: v23 = TypeTest v22 testedType=object
// CHECK-NEXT: Branch v23 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v24):
// CHECK-NEXT: Jump -> next b4(v24)
// CHECK-NEXT: b3(v25):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_8]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Meter"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_7]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Construct v2 calleeName="Meter"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_8]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_8]] site=[[w_18]]} results=[{type=number site=[[w_19]]}] {
// CHECK-NEXT: b0(v0: [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="amount"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_19]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#hidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_20]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_20]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#hidden"
// CHECK: module=[[m_0]] position={{*}} kind=Method flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_8]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
