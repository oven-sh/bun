// RUN: lower
// CHECK-LABEL: function {{*}}name="render"
// CHECK: [[children]] = NewArray contents=
// CHECK: AppendSpread [[children]],
// CHECK: = NewObject -, [[children]] layout=
// CHECK: [[isStatic]] = Boolean boolean=true
// CHECK: = Call {{*}}, [[isStatic]], {{*}}calleeName="jsxDEV"

export function render(list: unknown[]) {
  return <a>{...list}</a>;
}
