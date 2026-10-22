// RUN(METHOD): link
// METHOD: variable [[tokenVariable]] module=[[entry]] declared={type=classtoken flags=[IsFromCompiler]}
// METHOD: module [[entry]] path="{{*}}class-context"
// METHOD: evalscope [[scope]] flags=[IsInFunction, AllowsSuperProperty, AllowsNewTarget] bindings=
// METHOD-NOT: {kind=This
// METHOD: {name="Box" kind=Constant depth=
// METHOD: {name="#secret" kind=PrivateName depth=[[depth]] layout=[[box]] field=[[field]] operand=[[operand]]}
// METHOD: function [[method]] name="method" module=[[entry]]
// METHOD: [[token]] = GetModuleVariable variable=[[tokenVariable]]
// METHOD: = DirectEval {{*}}[[token]]{{*}}evalScope=[[scope]]

// RUN(DERIVED): link
// DERIVED: module [[entry]] path="{{*}}class-context"
// DERIVED: evalscope [[scope]] flags=[IsInFunction, IsInDerivedConstructor, AllowsSuperProperty, AllowsSuperCall, AllowsNewTarget] bindings=
// DERIVED: {kind=This depth=1 layout=
// DERIVED: {kind=ClassObject depth=
// DERIVED: function [[derived]] name="Derived" module=[[entry]]
// DERIVED: [[unbound]] = Undefined
// DERIVED: = DirectEval [[text]], [[unbound]], {{*}}evalScope=[[scope]]

// RUN(FIELD): link
// FIELD: module [[entry]] path="{{*}}class-context"
// FIELD: evalscope [[scope]] flags=[IsInArrowFunction, IsInFieldInitializer, AllowsSuperProperty, AllowsNewTarget] bindings=
// FIELD: function [[run]] name="run" module=[[entry]] {{*}}kind=Arrow
// FIELD: = DirectEval {{*}}evalScope=[[scope]]

// RUN(DECORATOR): link
// DECORATOR: module [[entry]] path="{{*}}class-context"
// DECORATOR: evalscope [[scope]] flags=[IsInFunction, AllowsNewTarget] bindings=[{name="text"
// DECORATOR: function [[decorate]] name="decorate" module=[[entry]]
// DECORATOR: = DirectEval {{*}}evalScope=[[scope]]

// RUN(OUTSIDE): link
// OUTSIDE-NOT: evalscope [[scope]] {{*}}{name="Marked"
// OUTSIDE-NOT: evalscope [[scope]] {{*}}{name="#hidden"

class Base {}

export class Box {
  #secret = 1;
  method(text) {
    return eval(text);
  }
}

export class Derived extends Base {
  constructor(text) {
    super();
    eval(text);
  }
}

export class Lazy {
  run = (text) => eval(text);
}

export function decorate(text) {
  return @(eval(text)) class Marked {
    #hidden = 1;
  };
}
