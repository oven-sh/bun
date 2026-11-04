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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="seen"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="evaluated "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Meter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_4]]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v6 = Integer integer=4
// CHECK-NEXT: v7 = ElemGet v5, v6
// CHECK-NEXT: v8 = Builtin builtin=CompilerHelpersRunInitializers [isNotReadFromHolder]
// CHECK-NEXT: v9 = Call v8, -, v7, v3
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="seen"
// CHECK-NEXT: v12 = PropGet v11 key="push"
// CHECK-NEXT: v13 = String string="constructor body "
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v15 = PrivateGet v3, v14 layout=[[L_3]]
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v17 = Call v16, v3 calleeName="this.#hidden"
// CHECK-NEXT: v18 = Add v13, v17
// CHECK-NEXT: v19 = Call v12, v11, v18 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v20 = Convert v19 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: v22 = TypeTest v21 testedType=object
// CHECK-NEXT: Branch v22 -> taken b1(| 0), notTaken b2(v3)
// CHECK-NEXT: b1(v23):
// CHECK-NEXT: Jump -> next b2(v23)
// CHECK-NEXT: b2(v24):
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Meter"
// CHECK-NEXT: v2 = Construct v1 calleeName="Meter"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="amount"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#hidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#hidden"
// CHECK: module=[[m_0]] position={{*}} kind=Method flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_3]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
