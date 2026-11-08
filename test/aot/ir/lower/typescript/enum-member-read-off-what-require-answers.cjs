// The value of the member is known at the build. What stands in front of the first dot does what it always did: the call runs the file, and a variable that holds nothing throws.
// RUN(CALL): lower
// CALL-LABEL: function {{*}}name="onTheCall"
// CALL-NEXT: b0():
// CALL-NEXT: EvaluateModule {{*}}[isCallOfRequire]
// CALL: [[high]] = Integer integer=1
// CALL-NEXT: Return [[high]]

// RUN(HELD): lower
// HELD-LABEL: function {{*}}name="onAVariable"
// HELD: RequireObjectCoercible {{*}}name="Level"
// HELD-NEXT: [[high]] = Integer integer=1
// HELD-NEXT: Return [[high]]

// A clause with such a test is evaluated when it is come to.
// RUN(CLAUSE): lower
// CLAUSE-LABEL: function {{*}}name="inAClause"
// CLAUSE-NEXT: b0(
// CLAUSE-NEXT: EvaluateModule {{*}}[isCallOfRequire]
// CLAUSE: [[high]] = Integer integer=1
// CLAUSE-NEXT: StrictEq {{*}}[[high]]
// CLAUSE-NOT: Switch

// FILE: main.cjs
function onTheCall() {
  return require("./levels.ts").Level.High;
}
function onAVariable(wanted) {
  if (wanted) {
    var held = require("./levels.ts");
  }
  return held.Level.High;
}
function inAClause(value) {
  switch (value) {
    case require("./levels.ts").Level.High:
      return "High";
    default:
      return "other";
  }
}
console.log(onTheCall, onAVariable, inAClause);

// FILE: levels.ts
console.log("levels.ts runs");
export enum Level {
  Low,
  High,
}
