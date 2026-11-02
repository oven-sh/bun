// In strict code too a function that a clause of a `switch` declares is there for every clause and test from the start of the `switch`, and a `--define` whose value is its name finds it, as the name written there does. `bun run` declares the function with `let` in front of the statements of its clause, so elsewhere the name is in its dead zone until that clause has run. Plain Bun prints another output.
// Flags: --define CLAUSE=target --define ELSEWHERE=target --define ELSEWHERE_CALLED=run --define ELSEWHERE_KIND=target --define ELSEWHERE_STORED=target --define TEST=target
globalThis.target = "the global";
globalThis.run = () => "the global";
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
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
console.log(
  ofAClause(0),
  attempt(() => ofAClause(1)),
  attempt(() => ofAClause(2)),
  attempt(() => ofAClause(3)),
  attempt(() => ofAClause(4)),
  attempt(() => inATest(0)),
);
/* Output:
function [Function: target] the function function the global the default
*/
