// RUN: lower
// CHECK: function {{*}}name="f" {{*}}kind=Arrow
// CHECK: function {{*}}name="#g"

// RUN(COMPUTED): lower
// COMPUTED-LABEL: function {{*}}kind=Initializer
// COMPUTED: SetFunctionName [[closure]], [[key]]
// COMPUTED: = NewClass [[closure]]
// COMPUTED: ElemDefine [[this]], [[key]],

// RUN(NAMED): lower
// NAMED-COUNT-1: SetFunctionName
// NAMED-NOT: SetFunctionName

declare const k: string;

export class C {
  f = () => {};
  #g = function () {};
  [k] = class {};
}
