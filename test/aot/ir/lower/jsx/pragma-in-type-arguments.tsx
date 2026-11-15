// In the type arguments of a tag `bun run` scans code too. Behind them it scans the tag again.

// RUN: lower
// CHECK-LABEL: function {{*}}name="element"
// CHECK-NOT: jsxDEV
// CHECK: calleeName="h"
// CHECK-NOT: calleeName="g"

function g(tag: unknown) {
  return tag;
}

function h(tag: unknown) {
  return tag;
}

function Component<T>(props: { b?: T }) {
  return null;
}

export function element() {
  return [<Component<number /* @jsxRuntime classic @jsx h */> /* @jsx g */ />, g];
}
