// RUN: link
// CHECK: layout {{*}}kind=Instance name="C" {{*}}fields=[{key="b" declared={type=number flags=[IsExpected]} flags=[IsRequired]}]

// RUN(ACCESSOR): link
// ACCESSOR-NOT: layout {{*}}name="C"{{*}}key="a"

export class C {
  set a(v) {}
  constructor() {
    this.a = 1;
    this.b = 2;
  }
}
