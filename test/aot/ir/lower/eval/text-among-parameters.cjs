// RUN(RECORD): link
// RECORD: evalscope [[scope]] mode=Sloppy {{*}}{name="a"{{*}}{kind=EvalVariables{{*}}{name="x" kind=Constant

// RUN(SLOPPY): lower
// SLOPPY-LABEL: function {{*}}name="declares"
// SLOPPY: [[variables]] = FinishObject
// SLOPPY: = DirectEval {{*}}[[variables]]
// SLOPPY: = ScopeHasBinding [[variables]] key="x"
// SLOPPY: [[isObject]] = TypeTest [[holder]] testedType=object
// SLOPPY: Branch [[isObject]] -> taken [[onObject]](| 0), notTaken [[onBinding]](| 0)
// SLOPPY: [[onObject]]([[found]]):
// SLOPPY: = PropGet [[found]] key="x"
// SLOPPY-NOT: outer!

// RUN(STRICT): lower
// STRICT-LABEL: function {{*}}name="keeps"
// STRICT-NOT: = FinishObject
// STRICT-NOT: ScopeHasBinding
// STRICT: = DirectEval
// STRICT-NOT: ScopeHasBinding
// STRICT: Return

// What text evaluated among the parameters of a sloppy function declares lies outside the parameters and inside everything around the function, so it hides a constant out there like any other name. In strict code it stays in the text.
function sloppy() {
  const x = "outer";
  function declares(a, b = eval("var x = 1")) {
    return x + "!";
  }
  return declares;
}

function strict() {
  "use strict";
  const x = "outer";
  function keeps(a, b = eval("var x = 1")) {
    return x;
  }
  return keeps;
}

module.exports = [sloppy, strict];
