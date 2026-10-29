// RUN: lower
// OPTIONS: builtin-modules

// Object literals that name a key more than once: values, accessors and methods replace each other, the key keeps its first place, and every value is still evaluated.
const trail = [];

function noted(value) {
  trail.push(String(value));
  return value;
}
function show(value) {
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + "=" + ("value" in property ? (typeof property.value === "function" ? "function" : String(property.value)) : (property.get ? "get" : "") + (property.set ? "set" : "")) + (property.enumerable ? "" : "!"));
  }
  return parts.join(" ") + " | " + trail.splice(0).join();
}

function valueTwice() {
  return { a: noted(1), b: noted(2), a: noted(3) };
}
function valueThrice() {
  return { a: noted(1), a: noted("two"), b: noted(2), a: noted(null) };
}
function otherSpellings() {
  return { a: noted(1), "a": noted(2), ["a"]: noted(3), 1: noted(4), "1": noted(5), 1.0: noted(6), 0x1: noted(7) };
}
function valueThenGetter() {
  return {
    a: noted(1),
    b: 2,
    get a() {
      return 3;
    },
  };
}
function getterThenValue() {
  return {
    get a() {
      return 3;
    },
    b: 2,
    a: noted(1),
  };
}
function getterThenSetter() {
  return {
    get a() {
      return 1;
    },
    b: 2,
    set a(value) {},
  };
}
function getterValueSetter() {
  return {
    get a() {
      return 1;
    },
    a: noted(2),
    set a(value) {},
  };
}
function twoGetters() {
  return {
    get a() {
      return "first";
    },
    get a() {
      return "second";
    },
  };
}
function methodThenValue() {
  return {
    a() {},
    b: 2,
    a: noted(1),
  };
}
function valueThenMethod() {
  return {
    a: noted(1),
    b: 2,
    a() {},
  };
}
function shorthandAndValue(a) {
  return { a, b: 2, a: noted(1), a };
}
function spreadBetween(source) {
  return { a: noted(1), ...source, a: noted(2), b: noted(3) };
}
function computedOverNamed(key) {
  return { a: noted(1), b: noted(2), [key]: noted(3), a: noted(4) };
}

console.log("value twice:", show(valueTwice()));
console.log("value thrice:", show(valueThrice()));
console.log("other spellings:", show(otherSpellings()));
console.log("value then getter:", show(valueThenGetter()), valueThenGetter().a);
console.log("getter then value:", show(getterThenValue()), getterThenValue().a);
console.log("getter then setter:", show(getterThenSetter()), getterThenSetter().a);
console.log("getter, value, setter:", show(getterValueSetter()), getterValueSetter().a);
console.log("two getters:", show(twoGetters()), twoGetters().a);
console.log("method then value:", show(methodThenValue()));
console.log("value then method:", show(valueThenMethod()));
console.log("shorthand and value:", show(shorthandAndValue("short")));
console.log("spread between:", show(spreadBetween({ b: "spread b", a: "spread a", c: "spread c" })));
console.log("spread between, empty:", show(spreadBetween({})));
console.log("computed over named:", show(computedOverNamed("a")), "/", show(computedOverNamed("b")), "/", show(computedOverNamed("c")));
console.log("again:", show(valueTwice()), "/", show(valueThenGetter()), "/", show(getterThenValue()));

export {};

// GENERATED: noted getterThenSetter spreadBetween computedOverNamed
// CHECK-LABEL: function {{*}}name="noted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="trail"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=String
// CHECK-NEXT: v6 = Call v5, -, v0 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v4, v2, v7 calleeKey="push" calleeName="trail.push"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getterThenSetter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_3]]
// CHECK-NEXT: v1 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineGetter v0, v1 key="a"
// CHECK-NEXT: v3 = NewClosure function=[[f_5]]
// CHECK-NEXT: DefineSetter v0, v3 key="a"
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropDefine v0, v6 key="b"
// CHECK-NEXT: v8 = FinishObject v0
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spreadBetween"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="noted"
// CHECK-NEXT: v4 = NewObject layout=[[L_7]]
// CHECK-NEXT: PropDefine v4, v3 key="a"
// CHECK-NEXT: CopyDataProperties v4, v0
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="noted"
// CHECK-NEXT: PropDefine v4, v9 key="a"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v12 = Integer integer=3
// CHECK-NEXT: v13 = Call v11, -, v12 calleeName="noted"
// CHECK-NEXT: PropDefine v4, v13 key="b"
// CHECK-NEXT: v15 = FinishObject v4
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computedOverNamed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[L_8]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="noted"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="noted"
// CHECK-NEXT: v7 = NewObject -, v3 layout=[[L_8]] fields=[0]
// CHECK-NEXT: PropDefine v7, v6 key="b"
// CHECK-NEXT: v9 = ToPropertyKey v0
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v11 = Integer integer=3
// CHECK-NEXT: v12 = Call v10, -, v11 calleeName="noted"
// CHECK-NEXT: ElemDefine v7, v9, v12
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v15 = Integer integer=4
// CHECK-NEXT: v16 = Call v14, -, v15 calleeName="noted"
// CHECK-NEXT: PropDefine v7, v16 key="a"
// CHECK-NEXT: v18 = FinishObject v7
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
