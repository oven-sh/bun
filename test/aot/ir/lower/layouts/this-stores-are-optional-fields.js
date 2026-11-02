// RUN: link
// CHECK: layout {{*}}kind=Instance name="C" {{*}}fields=[{key="a" declared={type=number flags=[IsExpected]} flags=[IsRequired]}, {key="b" declared={type=undefined|null|string flags=[IsExpected]} flags=[IsRequired]}, {key="c" declared={type=number flags=[IsExpected]}}, {key="d" declared={type=number flags=[IsExpected]}}]

// A store that every construction performs makes a required field. A store behind a test, or in a method, makes an optional one.
// The field holds more than the first value stored in it, so a literal gives its base type.
export class C {
  constructor(flag) {
    this.a = 1;
    this.b = "";
    if (flag) this.c = 2;
  }

  later() {
    this.d = 3;
  }
}
