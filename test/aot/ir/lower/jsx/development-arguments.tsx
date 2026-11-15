// RUN: lower
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="render"
// CHECK: b0([[this]]
// CHECK: [[jsxDEV]] = CheckInitialized {{*}}name="jsxDEV"
// CHECK: [[tag]] = String string="a"
// CHECK: [[props]] = FinishObject
// CHECK: [[key]] = Undefined
// CHECK: [[isStatic]] = Boolean @
// CHECK: [[source]] = Undefined
// CHECK: = Call [[jsxDEV]], -, [[tag]], [[props]], [[key]], [[isStatic]], [[source]], [[this]] calleeName="jsxDEV"

// RUN(MODULES): link
// MODULES: module {{*}}path="{{*}}/node_modules/react/jsx-dev-runtime.js"

export function render() {
  return <a b="1">x</a>;
}
