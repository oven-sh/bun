// RUN(EMPTY): lower
// EMPTY-LABEL: function {{*}}name="empty"
// EMPTY: [[jsxDEV]] = CheckInitialized {{*}}name="jsxDEV"
// EMPTY: [[fragment]] = CheckInitialized {{*}}name="Fragment"
// EMPTY-NOT: = NewArray
// EMPTY: = Call [[jsxDEV]], -, [[fragment]],

// RUN(CHILDREN): lower
// CHILDREN-LABEL: function {{*}}name="withChildren"
// CHILDREN: [[fragment]] = CheckInitialized {{*}}name="Fragment"
// CHILDREN: [[first]] = Call {{*}}calleeName="jsxDEV"
// CHILDREN: [[second]] = Call {{*}}calleeName="jsxDEV"
// CHILDREN: [[children]] = NewArray [[first]], [[second]] contents=
// CHILDREN: [[head]] = NewObject -, [[children]] layout=
// CHILDREN: [[props]] = FinishObject [[head]]
// CHILDREN: [[isStatic]] = Boolean boolean=true
// CHILDREN: = Call {{*}}, -, [[fragment]], [[props]], {{*}}, [[isStatic]],

export function empty() {
  return <></>;
}

export function withChildren() {
  return (
    <>
      <a />
      <b />
    </>
  );
}
