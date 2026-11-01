// RUN: link
// CHECK: layout {{*}}kind=Instance name="Derived" {{*}}fields=[{key="b" declared={type=number flags=[IsExpected]} flags=[IsRequired]}]
// CHECK: layout {{*}}kind=Instance name="TwoBelow" {{*}}fields=[{key="c" declared={type=number flags=[IsExpected]} flags=[IsRequired]}]
// CHECK: layout {{*}}kind=Instance name="BelowMethod" {{*}}fields=[{key="a" declared={type=number flags=[IsExpected]} flags=[IsRequired]}]
// CHECK: layout {{*}}kind=Instance name="DeclaresField" {{*}}key="a"

// RUN(ACCESSOR): link
// ACCESSOR-NOT: layout {{*}}name="Derived"{{*}}key="a"
// ACCESSOR-NOT: layout {{*}}name="TwoBelow"{{*}}key="a"

export class Base {
  set a(v) {}
  get a() {
    return 0;
  }
}
export class Derived extends Base {
  constructor() {
    super();
    this.a = 1;
    this.b = 2;
  }
}
export class TwoBelow extends Derived {
  constructor() {
    super();
    this.a = 3;
    this.c = 4;
  }
}
export class HidesWithMethod extends Base {
  a() {}
}
export class BelowMethod extends HidesWithMethod {
  constructor() {
    super();
    this.a = 5;
  }
}
export class DeclaresField extends Base {
  a = 6;
}
