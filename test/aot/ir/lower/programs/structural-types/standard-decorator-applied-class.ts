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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="keys ["
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.keys"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeKey="join" calleeName="join"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Add v1, v9
// CHECK-NEXT: v11 = String string="] json "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Builtin builtin=JSON
// CHECK-NEXT: v14 = PropGet v13 key="stringify"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Add v12, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Tagged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = String string="tagged"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="registered_as"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = NewArray v4 contents=anything
// CHECK-NEXT: v6 = ResolveHeritage v0
// CHECK-NEXT: v7 = NewClosure function=[[f_12]]
// CHECK-NEXT: v8 = NewClass v7, v0, v6 layout=[[L_13]]
// CHECK-NEXT: v9 = FinishClass v8 layout=[[L_13]]
// CHECK-NEXT: v10 = Builtin builtin=CompilerHelpersCreateDecoratorMetadata [isNotReadFromHolder]
// CHECK-NEXT: v11 = Call v10, -, v0
// CHECK-NEXT: v12 = NewArray contents=anything
// CHECK-NEXT: v13 = String string=""
// CHECK-NEXT: v14 = Builtin builtin=CompilerHelpersApplyClassDecorators [isNotReadFromHolder]
// CHECK-NEXT: v15 = Call v14, -, v5, v9, v13, v11, v12
// CHECK-NEXT: v16 = Builtin builtin=CompilerHelpersRunInitializers [isNotReadFromHolder]
// CHECK-NEXT: v17 = Call v16, -, v12, v15
// CHECK-NEXT: v18 = Convert v15 declared={type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_15]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_15]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_16]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
