// RUN: link
// CHECK: layout {{*}}kind=Instance name="C" {{*}}fields=[{key="a" declared={type=anything} flags=[IsRequired]}, {key="b" declared={type=anything} flags=[IsRequired]}, {key="c" declared={type=anything}}, {key="d" declared={type=anything}}]

// A store that every construction performs makes a required field. A store behind a test, or in a method, makes an optional one.
// Nothing is written of what the fields hold, so each is untyped.
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
