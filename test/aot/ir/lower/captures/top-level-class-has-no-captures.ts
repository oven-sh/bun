// RUN(CAPTURES): lower
// CAPTURES-COUNT-1: captures=[
// CAPTURES-NOT: captures=[

// RUN(ARROW): lower
// ARROW-LABEL: function {{*}}name="s"
// ARROW: captures=[{type=env {{*}}}, {type=anything}, {type=function flags=[IsFromCompiler]}] thisType
// ARROW: = CallDirect [[this]] function=

// RUN(TOKEN): lower
// TOKEN-LABEL: function {{*}}name="r"
// TOKEN: [[token]] = GetModuleVariable variable=
// TOKEN: = PrivateGet {{*}}, [[token]] layout=

// RUN(METHOD): lower
// METHOD-LABEL: function {{*}}name="n"
// METHOD: [[token]] = GetModuleVariable variable=
// METHOD: = PrivateGet {{*}}, [[token]] layout=
// METHOD: [[method]] = GetModuleVariable variable=
// METHOD: = Call [[method]],

// RUN(HOME): lower
// HOME-LABEL: function {{*}}name="m"
// HOME: [[class]] = GetModuleVariable variable=
// HOME: = GetSuperBase [[class]] homeKind=ClassPrototype

// RUN(CALLEE): lower
// CALLEE-LABEL: function {{*}}name="Derived"{{*}}TakesCallee
// CALLEE: b0([[callee]]: function,
// CALLEE: = GetSuperBase [[callee]]

declare function g(): unknown;

class B {
  base() {}
}

const a = g();

export class MethodDeclaredLater {
  n() {
    return this.#m();
  }
  #m() {}
}

export class PrivateField {
  #p = 1;
  r() {
    return this.#p;
  }
}

export class Derived extends B {
  constructor() {
    super();
  }
  m() {
    return super.base();
  }
}

export class SuperCallInArrow extends B {
  x = a;
  // @ts-ignore
  constructor() {
    // @ts-ignore
    const s = () => super();
    s();
  }
}
