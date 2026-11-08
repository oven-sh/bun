// `@jsxRuntime react-jsxdev` also says that the file is in development, as it does to `bun run`. The tsconfig.json here says "react-jsx".

// RUN: lower
// CHECK-LABEL: function {{*}}name="element"
// CHECK: calleeName="jsxDEV"
// CHECK-NOT: calleeName=

// RUN(MODULES): link
// MODULES: module {{*}}path="{{*}}/node_modules/react/jsx-dev-runtime.js"

// @jsxRuntime react-jsxdev
export function element() {
  return <a />;
}
