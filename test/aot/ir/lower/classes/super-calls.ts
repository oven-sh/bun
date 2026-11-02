// RUN: lower
// CHECK-LABEL: function {{*}}name="Values" {{*}}kind=DerivedConstructor
// CHECK: [[valuesParent]] = GetSuperBase [[valuesCallee]] @
// CHECK: = Call {{*}}calleeName="f"
// CHECK: [[valuesThis]] = SuperConstruct [[valuesParent]], {{*}}layout=[[values]]
// CHECK-NEXT: [[valuesReceiver]] = Convert [[valuesThis]] declared={type=[[values]] flags=[IsFromCompiler]}
// CHECK: = CallDirect [[valuesReceiver]] function=
// CHECK-LABEL: function {{*}}name="Spread" {{*}}kind=DerivedConstructor
// CHECK: [[spreadParent]] = GetSuperBase [[spreadCallee]] @
// CHECK: AppendSpread
// CHECK: [[spreadThis]] = SuperConstructList [[spreadParent]], {{*}}layout=[[spread]]
// CHECK-NEXT: [[spreadReceiver]] = Convert [[spreadThis]] declared={type=[[spread]] flags=[IsFromCompiler]}
// CHECK: = CallDirect [[spreadReceiver]] function=

declare function f(): number;

class Base {
  constructor(...values: number[]) {}
}

export class Values extends Base {
  x = 1;
  constructor() {
    super(f());
  }
}

export class Spread extends Base {
  x = 1;
  constructor(a: number[]) {
    super(...a);
  }
}
