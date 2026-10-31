// `bun run` decides an `if` that tests a member of an enum with `!` or `!!`, and removes a `let`, a `const` and a class behind a branch that returns, so a `--define` whose value is such a name finds what lies further out. The build finds the declaration and stops at the defined name.
// Flags: --define FLAG=flagged --define LEVEL=level --define NAMED=named
declare const FLAG: unknown, LEVEL: unknown, NAMED: unknown;
for (const name of ["flagged", "level", "named"]) {
  (globalThis as any)[name] = "the global";
}
const enum Build {
  Debug = 0,
}
enum Level {
  On = 1,
}
enum Mode {
  Name = "on",
}
function attempt(read: () => unknown): unknown {
  try {
    return read();
  } catch (error: any) {
    return error.constructor.name;
  }
}
function behindAMemberOfAConstEnum() {
  if (!Build.Debug) return FLAG;
  const flagged = "never declared";
}
function behindAMemberOfAnEnum() {
  if (!!Level.On) return LEVEL;
  let level = "never declared";
}
function behindAMemberThatIsAString() {
  if (!!Mode.Name) return NAMED;
  class named {}
}
console.log(attempt(behindAMemberOfAConstEnum), attempt(behindAMemberOfAnEnum), attempt(behindAMemberThatIsAString));
export {};
/* Build errors:
error: TS100050: --aot does not support --define FLAG=flagged where "flagged" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'FLAG="flagged"'
error: TS100050: --aot does not support --define LEVEL=level where "level" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'LEVEL="level"'
error: TS100050: --aot does not support --define NAMED=named where "named" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'NAMED="named"'
*/
