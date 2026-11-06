// RUN: lower
// A read of an `accessor` field that a test has narrowed is converted from the type of the slot that holds its value.
// CHECK-LABEL: function {{*}}name="double"
// CHECK: = TypeTest {{*}}testedType=number
// CHECK: [[read]] = PrivateGet {{*}}field=1 @
// CHECK-NEXT: [[narrowed]] = Convert [[read]] declared={type=number} illTypedCause=Assertion
// CHECK: = Mul [[narrowed]],

export class Box {
  accessor #value: number | string = 1;
  static double(box: Box): number {
    if (typeof box.#value === "number") {
      return box.#value * 2;
    }
    return box.#value.length;
  }
}
