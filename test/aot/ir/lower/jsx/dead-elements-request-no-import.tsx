// RUN: lower
// STATISTIC: SourceFilesInferred = 0
// CHECK-NOT: jsxDEV
// CHECK: function {{*}}name="render"
// CHECK-NOT: jsxDEV
// CHECK-NOT: = GetModuleVariable

// RUN(MODULES): link
// MODULES-NOT: path="{{*}}/node_modules/react/jsx-dev-runtime.js"

export function render() {
  if (false) {
    <a />;
  }
}
