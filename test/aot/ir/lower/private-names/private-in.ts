// RUN: lower
// CHECK-LABEL: function {{*}}name="hasField"
// CHECK: = PrivateHas {{*}}layout=[[layout]] field=1 @
// CHECK-LABEL: function {{*}}name="hasMethod"
// CHECK: = PrivateHas {{*}}layout=[[layout]] @

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
// FIELD-LABEL: function {{*}}name="hasStaticAccessorField"
// FIELD-NOT: RequireObject
// FIELD: = TypeTest {{*}}testedType=object
// FIELD: = TypeTest {{*}}testedType=absent

// RUN(THROWS): lower
// THROWS-LABEL: function {{*}}name="hasStaticField"
// THROWS: frequency=Unlikely:
// THROWS-NEXT: = PropHas {{*}}key="#s"
// THROWS-NEXT: Unreachable
// THROWS-LABEL: function {{*}}name="hasStaticAccessorField"
// THROWS: frequency=Unlikely:
// THROWS-NEXT: = PropHas {{*}}key="#a"
// THROWS-NEXT: Unreachable

// A static method or accessor has a message of its own, and is there as soon as the class is.
// RUN(BRAND): lower
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
}
