// `bun run` keeps a function that a block, a branch or a label of sloppy code declares in a block of its own, so a `--define` whose value begins with its name finds outside that block what lies further out. The build finds the variable of that name in the function around the block, and stops.
// The statements of a clause of a `switch` are no block of their own: `bun run` declares the function of a clause with `let` in front of them. In the test of a clause and in the other clauses the name is in its dead zone until that clause has run. The build finds the function there, and stops in the same way. In the clause that declares the function both find it.
// Flags: --define BEHIND=target --define BEFORE=target --define LABELLED=target --define INSIDE=target --define READ=target --define BRANCH=target --define COUNT=target.length --define CALLED=run --define STORED=target --define process.env.DELETED=target --define VAR=target --define PARAMETER=target --define VAR_CALLED=run --define CLAUSE=target --define ELSEWHERE=target --define ELSEWHERE_CALLED=run --define ELSEWHERE_KIND=target --define ELSEWHERE_STORED=target --define TEST=target --define FILE=ofTheFile
globalThis.target = "the global";
globalThis.run = () => "the global";
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
function behind() {
  {
    function target() {}
  }
  return typeof BEHIND;
}
function before() {
  const seen = typeof BEFORE;
  {
    function target() {}
  }
  return seen;
}
function labelled() {
  mark: function target() {}
  return typeof LABELLED;
}
function inside() {
  {
    function target() {}
    return typeof INSIDE;
  }
}
function read() {
  {
    function target() {}
  }
  return READ;
}
function underAnIf(on) {
  if (on) function target() {}
  return BRANCH;
}
function path() {
  {
    function target(first, second) {}
  }
  return COUNT;
}
function called() {
  {
    function run() {
      return "the function";
    }
  }
  return CALLED();
}
function stored() {
  {
    function target() {}
  }
  STORED = "stored";
  return globalThis.target;
}
function deleted() {
  {
    function target() {}
  }
  return delete process.env.DELETED;
}
function behindAVar() {
  var target;
  mark: function target() {}
  return typeof VAR;
}
function besideAParameter(target) {
  mark: function target() {}
  return PARAMETER;
}
function calledBehindAVar() {
  var run;
  mark: function run() {
    return "the function";
  }
  return VAR_CALLED();
}
function ofAClause(pick) {
  switch (pick) {
    case 0:
      function target() {}
      function run() {
        return "the function";
      }
      return typeof CLAUSE;
    case 1:
      return ELSEWHERE;
    case 2:
      return ELSEWHERE_CALLED();
    case 3:
      return typeof ELSEWHERE_KIND;
    default:
      ELSEWHERE_STORED = "stored";
      return globalThis.target;
  }
}
function inATest(pick) {
  switch (pick) {
    case TEST:
      return "the test";
    default:
      function target() {}
      return "the default";
  }
}
var ofTheFile;
mark: function ofTheFile() {}
console.log(behind(), before(), labelled(), inside(), read(), underAnIf(true), path(), called(), stored(), deleted());
console.log(behindAVar(), besideAParameter("the parameter"), attempt(calledBehindAVar), typeof FILE);
console.log(
  ofAClause(0),
  attempt(() => ofAClause(1)),
  attempt(() => ofAClause(2)),
  attempt(() => ofAClause(3)),
  attempt(() => ofAClause(4)),
  attempt(() => inATest(0)),
);
/* Build errors:
error: TS100050: --aot does not support --define BEHIND=target where BEHIND is an operand of typeof. The value is read as a name. A string needs quotes: --define 'BEHIND="target"'
error: TS100050: --aot does not support --define BEFORE=target where BEFORE is an operand of typeof. The value is read as a name. A string needs quotes: --define 'BEFORE="target"'
error: TS100050: --aot does not support --define LABELLED=target where LABELLED is an operand of typeof. The value is read as a name. A string needs quotes: --define 'LABELLED="target"'
error: TS100050: --aot does not support --define READ=target where READ is read. The value is read as a name. A string needs quotes: --define 'READ="target"'
error: TS100050: --aot does not support --define BRANCH=target where BRANCH is read. The value is read as a name. A string needs quotes: --define 'BRANCH="target"'
error: TS100050: --aot does not support --define COUNT=target.length where COUNT is read. The value is read as a name. A string needs quotes: --define 'COUNT="target.length"'
error: TS100050: --aot does not support --define CALLED=run where CALLED is called. The value is read as a name. A string needs quotes: --define 'CALLED="run"'
error: TS100050: --aot does not support --define STORED=target where STORED is stored to. The value is read as a name. A string needs quotes: --define 'STORED="target"'
error: TS100050: --aot does not support --define process.env.DELETED=target where process.env.DELETED is deleted. The value is read as a name. A string needs quotes: --define 'process.env.DELETED="target"'
error: TS100050: --aot does not support --define VAR=target where VAR is an operand of typeof. The value is read as a name. A string needs quotes: --define 'VAR="target"'
error: TS100050: --aot does not support --define PARAMETER=target where PARAMETER is read. The value is read as a name. A string needs quotes: --define 'PARAMETER="target"'
error: TS100050: --aot does not support --define VAR_CALLED=run where VAR_CALLED is called. The value is read as a name. A string needs quotes: --define 'VAR_CALLED="run"'
error: TS100050: --aot does not support --define ELSEWHERE=target where ELSEWHERE is read. The value is read as a name. A string needs quotes: --define 'ELSEWHERE="target"'
error: TS100050: --aot does not support --define ELSEWHERE_CALLED=run where ELSEWHERE_CALLED is called. The value is read as a name. A string needs quotes: --define 'ELSEWHERE_CALLED="run"'
error: TS100050: --aot does not support --define ELSEWHERE_KIND=target where ELSEWHERE_KIND is an operand of typeof. The value is read as a name. A string needs quotes: --define 'ELSEWHERE_KIND="target"'
error: TS100050: --aot does not support --define ELSEWHERE_STORED=target where ELSEWHERE_STORED is stored to. The value is read as a name. A string needs quotes: --define 'ELSEWHERE_STORED="target"'
error: TS100050: --aot does not support --define TEST=target where TEST is read. The value is read as a name. A string needs quotes: --define 'TEST="target"'
error: TS100050: --aot does not support --define FILE=ofTheFile where FILE is an operand of typeof. The value is read as a name. A string needs quotes: --define 'FILE="ofTheFile"'
*/
