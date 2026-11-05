// RUN(METHOD): lower
// METHOD-LABEL: function {{*}}name="instanceMethod"
// METHOD-NOT: Return
// METHOD: = GetSuperBase [[home]] homeKind=ClassPrototype

// RUN(FIELD): lower
// FIELD-LABEL: function {{*}}kind=Initializer{{*}}thisType={type=L{{*}} flags=[IsFromCompiler]}
// FIELD-NOT: Return
// FIELD: = GetSuperBase [[home]] homeKind=ClassPrototype

// RUN(STATICMETHOD): lower
// STATICMETHOD-LABEL: function {{*}}name="staticMethod"
// STATICMETHOD-NOT: Return
// STATICMETHOD: = GetSuperBase [[home]] @

// RUN(STATICBLOCK): lower
// STATICBLOCK-LABEL: function {{*}}kind=Initializer{{*}}thisType={type=function flags=[IsFromCompiler]}
// STATICBLOCK: = CallDirect [[this]] function=[[block]]
// STATICBLOCK: function [[block]] {{*}}kind=Method flags=[HasThis, IsChecked] thisType={type=function flags=[IsFromCompiler]}
// STATICBLOCK-NOT: Return
// STATICBLOCK: = GetSuperBase [[home]] @

// RUN(KINDS): lower
// KINDS-COUNT-2: homeKind=ClassPrototype
// KINDS-NOT: homeKind=ClassPrototype

class Base {
  m() {
    return 1;
  }
  static m() {
    return 2;
  }
}

export class Derived extends Base {
  field = super.m();
  instanceMethod() {
    return super.m();
  }
  static staticMethod() {
    return super.m();
  }
  static {
    super.m();
  }
}
