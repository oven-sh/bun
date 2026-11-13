// RUN(ONE): lower
// ONE-LABEL: function {{*}}name="oneChild"
// ONE: [[jsx]] = CheckInitialized {{*}}name="jsx"
// ONE: [[tag]] = String string="a"
// ONE: [[props]] = FinishObject
// ONE: = Call [[jsx]], -, [[tag]], [[props]] calleeName="jsx"

// RUN(TWO): lower
// TWO-LABEL: function {{*}}name="twoChildren"
// TWO: [[jsxs]] = CheckInitialized {{*}}name="jsxs"
// TWO: [[tag]] = String string="a"
// TWO: = NewArray
// TWO: [[props]] = FinishObject
// TWO: = Call [[jsxs]], -, [[tag]], [[props]] calleeName="jsxs"

// RUN(KEY): lower
// KEY-LABEL: function {{*}}name="withKey"
// KEY: [[jsx]] = CheckInitialized {{*}}name="jsx"
// KEY: [[tag]] = String string="a"
// KEY: [[props]] = FinishObject
// KEY: [[key]] = String string="k"
// KEY: = Call [[jsx]], -, [[tag]], [[props]], [[key]] calleeName="jsx"

// RUN(DEVELOPMENT): lower
// DEVELOPMENT-NOT: jsxDEV

export function oneChild() {
  return <a>x</a>;
}

export function twoChildren(y: unknown) {
  return <a>x{y}</a>;
}

export function withKey() {
  return <a key="k" />;
}
