// RUN: lower
// CHECK-LABEL: function {{*}}name="hasField"
// CHECK: = PrivateHas {{*}}layout=[[layout]] field=1 @
// CHECK-LABEL: function {{*}}name="hasMethod"
// CHECK: = PrivateHas {{*}}layout=[[layout]] @

// The getter and the setter of an `accessor` field are on the object before its value, as a method is. A read is one operation on the value.
// So is a store, and an update is one of each.
// CHECK-LABEL: function {{*}}name="hasAccessorField"
// CHECK: = PrivateHas {{*}}layout=[[layout]] @
// CHECK-LABEL: function {{*}}name="readAccessorField"
// CHECK-NOT: PrivateGet
// CHECK: = PrivateGet {{*}}layout=[[layout]] field=2 @
// CHECK-NOT: PrivateGet
// CHECK-LABEL: function {{*}}name="storeAccessorField"
// CHECK-NOT: PrivateGet
// CHECK-NOT: PrivateSet
// CHECK: PrivateSet {{*}}layout=[[layout]] field=2 @
// CHECK-NOT: PrivateGet
// CHECK-NOT: PrivateSet
// CHECK-LABEL: function {{*}}name="updateAccessorField"
// CHECK-NOT: PrivateGet
// CHECK-NOT: PrivateSet
// CHECK: = PrivateGet {{*}}layout=[[layout]] field=2 @
// CHECK-NOT: PrivateGet
// CHECK-NOT: PrivateSet
// CHECK: PrivateSet {{*}}layout=[[layout]] field=2 @
// CHECK-NOT: PrivateGet
// CHECK-NOT: PrivateSet

// An operand that is not an object is reported as the `in` operator reports it for any other key.
// RUN(FIELD): lower
// FIELD-LABEL: function {{*}}name="hasStaticField"
// FIELD-NOT: PrivateHas
// FIELD-NOT: RequireObject
// FIELD: [[isObject]] = TypeTest [[operand]] testedType=object
// FIELD-NEXT: Branch [[isObject]] -> taken [[objectBlock]](| 0), notTaken [[otherBlock]](| 0)
// FIELD: [[objectBlock]]([[object]]):
// FIELD: = StrictEq [[object]],
// FIELD: = TypeTest {{*}}testedType=absent

// RUN(THROWS): lower
// THROWS-LABEL: function {{*}}name="hasStaticField"
// THROWS: frequency=Unlikely:
// THROWS-NEXT: = PropHas {{*}}key="#s"
// THROWS-NEXT: Unreachable

// A static method or accessor has a message of its own, and is there as soon as the class is. So is an `accessor` field.
// RUN(BRAND): lower
// BRAND-LABEL: function {{*}}name="hasStaticAccessorField"
// BRAND-NOT: TypeTest
// BRAND: [[accessorField]] = RequireObject {{*}}runtimeError=PrivateStaticTestOfNonObject
// BRAND: = StrictEq [[accessorField]],
// BRAND-NOT: TypeTest
// BRAND-LABEL: function {{*}}name="hasStaticMethod"
// BRAND-NOT: TypeTest
// BRAND: [[method]] = RequireObject {{*}}runtimeError=PrivateStaticTestOfNonObject
// BRAND: = StrictEq [[method]],
// BRAND-NOT: TypeTest
// BRAND-LABEL: function {{*}}name="hasStaticGetter"
// BRAND-NOT: TypeTest
// BRAND: [[getter]] = RequireObject {{*}}runtimeError=PrivateStaticTestOfNonObject
// BRAND: = StrictEq [[getter]],
// BRAND-NOT: TypeTest

// RUN(ADMISSION): lower
// ADMISSION-NOT: InvalidPrivateBrand

export class C {
  #x = 1;
  #m() {}
  static #s = 2;
  static accessor #a = 3;
  static #sm() {}
  static get #sg() {
    return 4;
  }
  static hasField(o: object) {
    return #x in o;
  }
  static hasMethod(o: object) {
    return #m in o;
  }
  static hasStaticField(o: object) {
    return #s in o;
  }
  static hasStaticAccessorField(o: object) {
    return #a in o;
  }
  static hasStaticMethod(o: object) {
    return #sm in o;
  }
  static hasStaticGetter(o: object) {
    return #sg in o;
  }
  accessor #v = 5;
  static hasAccessorField(o: object) {
    return #v in o;
  }
  static readAccessorField(o: C) {
    return o.#v;
  }
  static storeAccessorField(o: C) {
    o.#v = 6;
  }
  static updateAccessorField(o: C) {
    ++o.#v;
  }
}
