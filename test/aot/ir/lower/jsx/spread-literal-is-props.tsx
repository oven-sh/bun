// RUN(ONLY): lower
// ONLY-LABEL: function {{*}}name="only"
// ONLY-COUNT-1: = NewObject
// ONLY-NOT: = NewObject
// ONLY-NOT: CopyDataProperties
// ONLY: [[props]] = FinishObject
// ONLY-NOT: = NewObject
// ONLY-NOT: CopyDataProperties
// ONLY: = Call {{*}}, [[props]], {{*}}calleeName="jsxDEV"

// RUN(CHILD): lower
// CHILD-LABEL: function {{*}}name="withChild"
// CHILD: [[props]] = FinishObject
// CHILD-NOT: = NewObject
// CHILD-NOT: CopyDataProperties
// CHILD: [[child]] = String string="x"
// CHILD: PropDefine [[props]], [[child]] key="children"
// CHILD: = Call {{*}}, [[props]], {{*}}calleeName="jsxDEV"

// RUN(ATTRIBUTE): lower
// ATTRIBUTE-LABEL: function {{*}}name="withAttribute"
// ATTRIBUTE: [[literal]] = FinishObject
// ATTRIBUTE: [[head]] = NewObject layout=[[layout]] @
// ATTRIBUTE-NEXT: CopyDataProperties [[head]], [[literal]] @
// ATTRIBUTE: PropDefine [[head]], {{*}}key="b"
// ATTRIBUTE: [[props]] = FinishObject [[head]]
// ATTRIBUTE: = Call {{*}}, [[props]], {{*}}calleeName="jsxDEV"

declare const C: any;

export function only(v: unknown) {
  return <C {...{ a: v }} />;
}

export function withChild(v: unknown) {
  return <C {...{ a: v }}>x</C>;
}

export function withAttribute(v: unknown) {
  return <C {...{ a: v }} b />;
}
