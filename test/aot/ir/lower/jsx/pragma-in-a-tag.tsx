// `bun run` passes over a comment while it scans a tag and reads no pragma there, so the file keeps the automatic runtime.

// RUN: lower
// CHECK-LABEL: function {{*}}name="elements"
// CHECK-COUNT-9: calleeName="jsxDEV"
// CHECK-NOT: calleeName=

function h(tag: unknown) {
  return tag;
}

export function elements(o: object) {
  return [
    <a /* @jsxRuntime classic @jsx h */ b="1" />,
    < /* @jsxRuntime classic @jsx h */ a />,
    <a b= /* @jsxRuntime classic @jsx h */ "1" />,
    <a b={1} /* @jsxRuntime classic @jsx h */ />,
    <a {...o} // @jsxRuntime classic @jsx h
    />,
    <a></a /* @jsxRuntime classic @jsx h */ >,
    <a b={<c /* @jsxRuntime classic @jsx h */ />} />,
    < /* @jsxRuntime classic @jsx h */ ></>,
    h,
  ];
}
