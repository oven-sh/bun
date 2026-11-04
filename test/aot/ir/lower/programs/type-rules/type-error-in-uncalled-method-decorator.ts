// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[first]] = PropGet {{*}}key="first"
// CHECK-NEXT: Call {{*}}, [[first]] calleeName="made"
// CHECK: PropGet {{*}}key="second"
// CHECK: [[third]] = PropGet {{*}}key="third"
// CHECK-NEXT: Call {{*}}, [[third]] calleeName="made"
// CHECK: [[fourth]] = PropGet {{*}}key="fourth"
// CHECK-NEXT: Call {{*}}, [[fourth]] calleeName="made"
// CHECK: [[fifth]] = PropGet {{*}}key="fifth"
// CHECK-NEXT: Call {{*}}, [[fifth]] calleeName="made"
// CHECK-LABEL: function {{*}}name="plain"

// A type error stops no build. The decorators of a method are evaluated with the class, also where nobody calls the method: each read of a member that `number` lacks stands in the body of the module.
const plain = (value: unknown, context: unknown) => {};
const made = (option: unknown) => (value: unknown, context: unknown) => {};
class Decorated {
  @made((1 as number).first) method() {}
  @((1 as number).second, plain) static fixed() {}
  @made((1 as number).third) get read() { return 1; }
  @made((1 as number).fourth) set written(value: number) {}
  @made((1 as number).fifth) async *steps() {}
}
console.log(typeof Decorated);
