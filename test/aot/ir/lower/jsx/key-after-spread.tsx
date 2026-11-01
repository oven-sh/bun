// RUN(SPREAD): lower
// DIAGNOSTIC: TS100510 1
// DIAGNOSTIC: TS100511 1
// SPREAD-LABEL: function {{*}}name="afterSpread"
// SPREAD-NOT: name="jsxDEV"
// SPREAD: [[createElement]] = CheckInitialized {{*}}name="createElement"
// SPREAD: [[tag]] = String string="a"
// SPREAD: [[head]] = NewObject
// SPREAD: CopyDataProperties [[head]],
// SPREAD: PropDefine [[head]], {{*}}key="key"
// SPREAD: [[props]] = FinishObject [[head]]
// SPREAD: = Call [[createElement]], -, [[tag]], [[props]] calleeName="createElement"

// RUN(IGNORED): lower
// IGNORED-LABEL: function {{*}}name="withoutValue"
// IGNORED-NOT: key="key"
// IGNORED: [[props]] = FinishObject
// IGNORED: [[key]] = Undefined
// IGNORED: = Call {{*}}, [[props]], [[key]], {{*}}calleeName="jsxDEV"

export function afterSpread(p: object) {
  return <a {...p} key="k" />;
}

export function withoutValue() {
  return <a key />;
}
