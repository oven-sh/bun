// RUN(METHOD): link
// METHOD: variable [[tokenVariable]] module=[[entry]] declared={type=classtoken flags=[IsFromCompiler]}
// METHOD: module [[entry]] path="{{*}}class-context.js"
// METHOD: evalscope [[scope]] flags=[IsInFunction, AllowsSuperProperty, AllowsNewTarget] bindings=
// METHOD-NOT: {kind=This
// METHOD: {name="Box" kind=Constant depth=
// METHOD: {name="#secret" kind=PrivateName depth=[[depth]] layout=[[box]] field=[[field]] operand=[[operand]]}
// METHOD: function [[method]] name="method" module=[[entry]]
// METHOD: [[token]] = GetModuleVariable variable=[[tokenVariable]]
// METHOD: = DirectEval {{*}}[[token]]{{*}}evalScope=[[scope]]

// RUN(DERIVED): link
// DERIVED: module [[entry]] path="{{*}}class-context.js"
// DERIVED: evalscope [[scope]] flags=[IsInFunction, IsInDerivedConstructor, AllowsSuperProperty, AllowsSuperCall, AllowsNewTarget] bindings=
// DERIVED: {kind=This depth=1 layout=
// DERIVED: {kind=ClassObject depth=
// DERIVED: function [[derived]] name="Derived" module=[[entry]]
// DERIVED: [[unbound]] = Undefined
// DERIVED: = DirectEval [[text]], [[unbound]], {{*}}evalScope=[[scope]]

// RUN(ALONE): link
// ALONE: module [[entry]] path="{{*}}class-context.js"
// ALONE: evalscope [[scope]] flags=[IsInFunction, AllowsSuperProperty, AllowsSuperCall, AllowsNewTarget] bindings=
// ALONE: {kind=This depth=1 layout=
// ALONE: {kind=ClassObject depth=
// ALONE: function [[alone]] name="Alone" module=[[entry]]
// ALONE: = DirectEval {{*}}evalScope=[[scope]]

// RUN(ARROW): link
// ARROW: module [[entry]] path="{{*}}class-context.js"
// ARROW: evalscope [[scope]] flags=[IsInFunction, IsInArrowFunction, AllowsSuperProperty, AllowsNewTarget] bindings=
// ARROW: function [[later]] name="later" module=[[entry]] {{*}}kind=Arrow
// ARROW: = DirectEval {{*}}evalScope=[[scope]]

// RUN(FIELD): link
// FIELD: module [[entry]] path="{{*}}class-context.js"
// FIELD: evalscope [[scope]] flags=[IsInArrowFunction, IsInFieldInitializer, AllowsSuperProperty, AllowsNewTarget] bindings=
// FIELD: function [[run]] name="run" module=[[entry]] {{*}}kind=Arrow
// FIELD: = DirectEval {{*}}evalScope=[[scope]]

// RUN(DECORATOR): link
// DECORATOR: module [[entry]] path="{{*}}class-context.js"
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

export class Alone {
  constructor(text) {
    eval(text);
  }
}

export class Deferred {
  constructor(text) {
    const later = () => eval(text);
    later();
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
