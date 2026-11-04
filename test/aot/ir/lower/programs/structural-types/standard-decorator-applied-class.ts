// RUN: lower
// OPTIONS: builtin-modules

// A standard decorator is applied to the class expression of a mixin.
function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const registered: string[] = [];

function registered_as(label: string) {
  return function <T extends new (...args: any[]) => object>(target: T, context: ClassDecoratorContext<T>) {
    registered.push(label + " over " + Object.getPrototypeOf(target).name);
    return class extends target {
      stamped = label;
    };
  };
}

class Point {
  x = 1;
}

class Name {
  first = "f";
}

function Tagged(Base: new () => object) {
  return @registered_as("tagged") class extends Base {
    tag = "tag";
  };
}

console.log(describe(new (Tagged(Point))()));
console.log(describe(new (Tagged(Name))()));
console.log(describe(new (Tagged(Tagged(Point)))()));
console.log(registered.join(", "));

// GENERATED: describe Tagged Point
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = String string="keys ["
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.keys"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeKey="join" calleeName="join"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Add v1, v9
// CHECK-NEXT: v11 = String string="] json "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Builtin builtin=JSON
// CHECK-NEXT: v14 = PropGet v13 key="stringify"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Add v12, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Tagged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = String string="tagged"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="registered_as"
// CHECK-NEXT: v4 = NewArray v3 contents=anything
// CHECK-NEXT: v5 = ResolveHeritage v0
// CHECK-NEXT: v6 = NewClosure function=[[f_3]]
// CHECK-NEXT: v7 = NewClass v6, v0, v5 layout=[[L_4]]
// CHECK-NEXT: v8 = FinishClass v7 layout=[[L_4]]
// CHECK-NEXT: v9 = Builtin builtin=CompilerHelpersCreateDecoratorMetadata [isNotReadFromHolder]
// CHECK-NEXT: v10 = Call v9, -, v0
// CHECK-NEXT: v11 = NewArray contents=anything
// CHECK-NEXT: v12 = String string=""
// CHECK-NEXT: v13 = Builtin builtin=CompilerHelpersApplyClassDecorators [isNotReadFromHolder]
// CHECK-NEXT: v14 = Call v13, -, v4, v8, v12, v10, v11
// CHECK-NEXT: v15 = Builtin builtin=CompilerHelpersRunInitializers [isNotReadFromHolder]
// CHECK-NEXT: v16 = Call v15, -, v11, v14
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_6]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
