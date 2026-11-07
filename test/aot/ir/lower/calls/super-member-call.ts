// RUN: lower
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: b0([[this]]: {{*}}, [[k]]: anything, [[x]]: anything):
// CHECK: [[computedBase]] = GetSuperBase {{*}}homeKind=ClassPrototype
// CHECK: [[convertedK]] = Convert [[k]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: [[key]] = Call [[convertedK]] calleeName="k"
// CHECK: [[computedMethod]] = SuperGet [[computedBase]], [[this]], [[key]]
// CHECK: = Call [[computedMethod]], [[this]], [[x]]
// CHECK-NOT: calleeName
// CHECK-LABEL: function {{*}}name="named"
// CHECK: b0([[this]]: {{*}}, [[argument]]: anything):
// CHECK: [[namedBase]] = GetSuperBase {{*}}homeKind=ClassPrototype
// CHECK: [[namedMethod]] = SuperGet [[namedBase]], [[this]] key="m"
// CHECK: = Call [[namedMethod]], [[this]], [[argument]] calleeName="super.m"
// CHECK-LABEL: function {{*}}name="method"
// CHECK: [[literalBase]] = GetSuperBase
// CHECK-NOT: homeKind=
// CHECK: [[literalMethod]] = SuperGet [[literalBase]], [[receiver]] key="m"
// CHECK: = Call [[literalMethod]], [[receiver]] calleeName="super.m"

// RUN(NOWHERE): lower
// NOWHERE-NOT: calleeKey

class Base {
  [key: string]: any;
  m(x?: any): any {}
}

export class Derived extends Base {
  computed(k: any, x: any) {
    super[k()](x);
  }

  named(x: any) {
    super.m(x);
  }
}

export const literal = {
  method() {
    super.m();
  },
};
