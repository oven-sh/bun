// A function that a block, a branch or a label of sloppy code declares is a variable of the function around it, and a `--define` whose value begins with its name finds that variable, as the name written there does. `bun run` keeps such a function in a block of its own, so outside that block the value finds what lies further out: "A function declared in a block" in docs/compiler/compatibility.mdx.
// A function of a clause of a `switch` is there for every clause and test from the start of the `switch`. `bun run` declares it with `let` in front of the statements of its clause, so elsewhere the name is in its dead zone until that clause has run. Plain Bun prints another output.
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
/* Output:
function undefined function function [Function: target] [Function: target] 2 the function the global false
function [Function: target] the function function
function [Function: target] the function function the global the default
*/
