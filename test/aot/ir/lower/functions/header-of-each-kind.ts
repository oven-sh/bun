// RUN(DECLARATION): lower
// DECLARATION: function {{*}}name="declared"{{*}}flags=[IsChecked, HasExplicitName]

// RUN(EXPRESSION): lower
// EXPRESSION: function {{*}}name="expression"{{*}}flags=[IsChecked]

// RUN(ARROW): lower
// ARROW: function {{*}}name="arrow"{{*}}kind=Arrow flags=[IsChecked]

// RUN(METHOD): lower
// METHOD: function {{*}}name="method"{{*}}kind=Method flags=[IsChecked, HasExplicitName]

// RUN(GETTER): lower
// GETTER: function {{*}}name="getter"{{*}}kind=Getter flags=[IsChecked, HasExplicitName]

// RUN(SETTER): lower
// SETTER: function {{*}}name="setter"{{*}}kind=Setter flags=[IsChecked, HasExplicitName]

// RUN(BASE): lower
// BASE: function {{*}}name="Base"{{*}}kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName]

// RUN(DERIVED): lower
// DERIVED: function {{*}}name="Derived"{{*}}kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName]

// RUN(ASYNC): lower
// ASYNC: function {{*}}name="asynchronous"{{*}}flags=[IsAsync, IsChecked, HasExplicitName]

// RUN(GENERATOR): lower
// GENERATOR: function {{*}}name="generator"{{*}}flags=[IsGenerator, TakesCallee, IsChecked, HasExplicitName]

// RUN(PLAIN): lower
// PLAIN-NOT: name="declared"{{*}}kind=
// PLAIN-NOT: name="expression"{{*}}kind=
// PLAIN-NOT: name="asynchronous"{{*}}kind=
// PLAIN-NOT: name="generator"{{*}}kind=

export function declared() {}

export const expression = function () {};

export const arrow = () => 1;

export const object = {
  method() {},
  get getter() {
    return 1;
  },
  set setter(value: number) {},
};

export class Base {
  constructor() {}
}

export class Derived extends Base {
  constructor() {
    super();
  }
}

export async function asynchronous() {}

export function* generator() {}
