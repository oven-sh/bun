// RUN: lower
// CHECK-LABEL: function {{*}}name="addToName"
// CHECK: [[addBase]] = GetSuperBase
// CHECK: [[old]] = SuperGet [[addBase]], [[addThis]] key="x"
// CHECK: [[sum]] = Add [[old]],
// CHECK: SuperSet [[addBase]], [[addThis]], [[sum]] key="x"
// CHECK-LABEL: function {{*}}name="readComputed"
// CHECK: [[computedBase]] = GetSuperBase
// CHECK: [[computedKey]] = Call {{*}}calleeName="k"
// CHECK: = SuperGet [[computedBase]], [[computedThis]], [[computedKey]] @
// CHECK-LABEL: function {{*}}name="readName"
// CHECK: [[nameBase]] = GetSuperBase {{*}}homeKind=ClassPrototype
// CHECK: = SuperGet [[nameBase]], [[nameThis]] key="x"
// CHECK-LABEL: function {{*}}name="storeName"
// CHECK: [[storeBase]] = GetSuperBase
// CHECK: [[stored]] = Call {{*}}calleeName="v"
// CHECK: SuperSet [[storeBase]], [[storeThis]], [[stored]] key="x"
// CHECK-LABEL: function {{*}}name="updateComputed"
// CHECK: [[updateBase]] = GetSuperBase
// CHECK: [[called]] = Call {{*}}calleeName="k"
// CHECK: [[isObject]] = TypeTest [[called]] testedType=object @
// CHECK-NEXT: Branch [[isObject]] -> taken [[convert]](| 0), notTaken [[keep]](| 0)
// CHECK: [[convert]]([[objectKey]]):
// CHECK: RequireObjectCoercible [[updateBase]]
// CHECK: [[converted]] = ToPropertyKey [[objectKey]]
// CHECK: Jump -> next [[join]]([[converted]])
// CHECK: [[join]]([[key]]):
// CHECK: [[before]] = SuperGet [[updateBase]], [[updateThis]], [[key]] @
// CHECK: [[after]] = Increment [[before]]
// CHECK: SuperSet [[updateBase]], [[updateThis]], [[after]], [[key]] @

// RUN(CONVERSIONS): lower
// CONVERSIONS-COUNT-1: ToPropertyKey
// CONVERSIONS-NOT: ToPropertyKey

// RUN(TESTS): lower
// TESTS-LABEL: function {{*}}name="addToName"
// TESTS-NOT: TypeTest
// TESTS-LABEL: function {{*}}name="updateComputed"

class Base {}

export class Derived extends Base {
  addToName() {
    super.x += 1;
  }

  readComputed(k) {
    return super[k()];
  }

  readName() {
    return super.x;
  }

  storeName(v) {
    super.x = v();
  }

  updateComputed(k) {
    super[k()]++;
  }
}
