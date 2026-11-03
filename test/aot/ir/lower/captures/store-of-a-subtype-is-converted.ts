// RUN: lower
// CHECK: [[failed]] = Convert {{*}}declared={type=undefined|null|TypeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: [[error]] = Convert [[failed]] declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField {{*}}, [[error]] layout=
// CHECK: [[made]] = Convert {{*}}declared={type=undefined|null|[[derived]] site=w{{*}}} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: [[held]] = Convert [[made]] declared={type=undefined|null|[[base]] site=w{{*}}} @
// CHECK-NEXT: PutEnvironmentField {{*}}, [[held]] layout=

// What is stored into a captured variable is converted to the type of the variable, as for any other variable. The checker has proven the
// conversion of a subtype, so it has no cause.

class Base {
  a = 1;
}
class Derived extends Base {
  b = 2;
}
declare function make(): Derived;
declare function fail(): TypeError;

export function classes() {
  let held: Base = new Base();
  const change = () => {
    held = make();
  };
  change();
  return held;
}

export function builtins() {
  let error: Error = new Error();
  const change = () => {
    error = fail();
  };
  change();
  return error;
}
