// In strict code too `bun run` declares a function of a clause of a `switch` with `let`, so a `--define` whose value is its name finds it in its dead zone outside that clause until the clause has run. The build finds the function there and stops at the defined name.
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
/* Build errors:
error: TS100050: --aot does not support --define ELSEWHERE=target where ELSEWHERE is read. The value is read as a name. A string needs quotes: --define 'ELSEWHERE="target"'
error: TS100050: --aot does not support --define ELSEWHERE_CALLED=run where ELSEWHERE_CALLED is called. The value is read as a name. A string needs quotes: --define 'ELSEWHERE_CALLED="run"'
error: TS100050: --aot does not support --define ELSEWHERE_KIND=target where ELSEWHERE_KIND is an operand of typeof. The value is read as a name. A string needs quotes: --define 'ELSEWHERE_KIND="target"'
error: TS100050: --aot does not support --define ELSEWHERE_STORED=target where ELSEWHERE_STORED is stored to. The value is read as a name. A string needs quotes: --define 'ELSEWHERE_STORED="target"'
error: TS100050: --aot does not support --define TEST=target where TEST is read. The value is read as a name. A string needs quotes: --define 'TEST="target"'
*/
