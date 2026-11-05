// RUN: lower
// CHECK-LABEL: function {{*}}name="render"
// CHECK: [[tag]] = PropGet {{*}}key="C" [isFreeName]
// CHECK: = Call {{*}}calleeName="f"
// CHECK: = Call {{*}}calleeName="g"
// CHECK: = Call {{*}}calleeName="h"
// CHECK: [[props]] = FinishObject
// CHECK: [[key]] = Call {{*}}calleeName="k"
// CHECK: = Call {{*}}, [[tag]], [[props]], [[key]], {{*}}calleeName="jsxDEV"

declare const C: any;
declare function f(): unknown;
declare function g(): object;
declare function h(): unknown;
declare function k(): unknown;

export function render() {
  return (
    <C a={f()} key={k()} {...g()}>
      {h()}
    </C>
  );
}
