// Between the braces of an attribute `bun run` scans code, and a comment there holds a pragma for the whole file, as one outside a tag does.

// RUN: lower
// CHECK-LABEL: function {{*}}name="element"
// CHECK-NOT: jsxDEV
// CHECK: calleeName="h"
// CHECK-NOT: jsxDEV

function h(tag: unknown) {
  return tag;
}

export function element() { // @ts-expect-error
  return <a b={/* @jsxRuntime classic @jsx h */ 1} />;
}
