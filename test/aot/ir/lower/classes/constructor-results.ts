// RUN(BASE): lower
// BASE-LABEL: function {{*}}name="ReturnsValue" {{*}}kind=BaseConstructor
// BASE: [[allocated]] = NewObject {{*}}layout=[[layout]] @
// BASE-NEXT: [[this]] = Convert [[allocated]] declared={type=[[layout]]}
// BASE: [[isObject]] = TypeTest {{*}}testedType=object
// BASE-NEXT: Branch [[isObject]] -> taken [[object]](| 0), notTaken [[join]]([[this]])
// BASE: [[object]]([[result]]):
// BASE-NEXT: Jump -> next [[join]]([[result]])
// BASE-NOT: TypeTest
// BASE-LABEL: function {{*}}name="FallsOff" {{*}}kind=BaseConstructor
// BASE: [[made]] = Convert {{*}}declared={type=L
// BASE-NOT: TypeTest
// BASE: Return [[made]]
// BASE-LABEL: function {{*}}name="DerivedReturnsValue"

// RUN(DERIVED): lower
// DERIVED-LABEL: function {{*}}name="DerivedReturnsValue" {{*}}kind=DerivedConstructor
// DERIVED: = TypeTest {{*}}testedType=object
// DERIVED: = TypeTest {{*}}testedType=undefined
// DERIVED: = NewRuntimeError runtimeError=DerivedConstructorResult name="DerivedReturnsValue"
// DERIVED-LABEL: function {{*}}name="DerivedFallsOff" {{*}}kind=DerivedConstructor
// DERIVED-NOT: TypeTest
// DERIVED-NOT: NewRuntimeError

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
