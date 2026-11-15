// `@jsxRuntime react-jsx` also says that the file is not in development, as it does to `bun run`. The tsconfig.json here says "react-jsxdev".

// RUN: lower
// CHECK-LABEL: function {{*}}name="elements"
// CHECK: calleeName="jsx"
// CHECK: calleeName="jsxs"
// CHECK-NOT: calleeName=

// RUN(MODULES): link
// MODULES: module {{*}}path="{{*}}/node_modules/react/jsx-runtime.js"

// @jsxRuntime react-jsx
export function elements() {
  return [<a />, <a>{1}{2}</a>];
}
