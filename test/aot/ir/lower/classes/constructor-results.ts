// RUN(BASE): lower
// BASE-LABEL: function {{*}}name="ReturnsValue" {{*}}kind=BaseConstructor
// BASE: [[allocated]] = NewObject {{*}}layout=[[layout]] @
// BASE-NEXT: [[this]] = Convert [[allocated]] declared={type=[[layout]] flags=[IsFromCompiler]}
// BASE: [[isObject]] = TypeTest {{*}}testedType=object
// BASE-NEXT: Branch [[isObject]] -> taken [[object]](| 0), notTaken [[other]](| 0)
// BASE: [[object]]([[result]]):
// BASE-NEXT: Jump -> next [[join]]([[result]])
// BASE: [[other]]({{*}}):
// BASE-NEXT: Jump -> next [[join]]([[this]])
// BASE-NOT: TypeTest
// BASE-LABEL: function {{*}}name="FallsOff" {{*}}kind=BaseConstructor
// BASE: [[undefined]] = Undefined
// BASE: = TypeTest [[undefined]] testedType=object
// BASE-NOT: TypeTest
// BASE-LABEL: function {{*}}name="DerivedReturnsValue"

// RUN(DERIVED): lower
// DERIVED-LABEL: function {{*}}name="DerivedReturnsValue" {{*}}kind=DerivedConstructor
// DERIVED: = TypeTest {{*}}testedType=object
// DERIVED: = TypeTest {{*}}testedType=undefined
// DERIVED: = NewRuntimeError runtimeError=DerivedConstructorResult name="DerivedReturnsValue"
// DERIVED-LABEL: function {{*}}name="DerivedFallsOff" {{*}}kind=DerivedConstructor
// DERIVED: = TypeTest {{*}}testedType=object
// DERIVED: = TypeTest {{*}}testedType=undefined
// DERIVED: = NewRuntimeError runtimeError=DerivedConstructorResult name="DerivedFallsOff"

declare const v: any;

class Base {}

export class ReturnsValue {
  constructor() {
    return v;
  }
}

export class FallsOff {
  constructor() {}
}

export class DerivedReturnsValue extends Base {
  constructor() {
    super();
    return v;
  }
}

export class DerivedFallsOff extends Base {
  constructor() {
    super();
  }
}
