// As a condition `typeof` is true whatever its operand is, and `bun run` does not evaluate it below `!` or in the test of `if` or of `?:`: it does not throw above the declaration of the `let` that a `--define` value names. The build stops at such a `typeof`.
// Flags: --define BRANCH=target --define PICK=target --define NOT=target --define EITHER=target --define LAST=target
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
const no = () => false;
console.log(
  attempt(() => {
    if (typeof BRANCH) return "the branch";
  }),
  attempt(() => (typeof PICK ? "the first" : "the second")),
  attempt(() => !typeof NOT),
  attempt(() => {
    if (no() || typeof EITHER) return "the branch";
  }),
  attempt(() => ((no(), typeof LAST) ? "the first" : "the second")),
);
let target = 1;
/* Build errors:
error: TS100050: --aot does not support --define BRANCH=target where BRANCH is an operand of typeof. The value is read as a name. A string needs quotes: --define 'BRANCH="target"'
error: TS100050: --aot does not support --define PICK=target where PICK is an operand of typeof. The value is read as a name. A string needs quotes: --define 'PICK="target"'
error: TS100050: --aot does not support --define NOT=target where NOT is an operand of typeof. The value is read as a name. A string needs quotes: --define 'NOT="target"'
error: TS100050: --aot does not support --define EITHER=target where EITHER is an operand of typeof. The value is read as a name. A string needs quotes: --define 'EITHER="target"'
error: TS100050: --aot does not support --define LAST=target where LAST is an operand of typeof. The value is read as a name. A string needs quotes: --define 'LAST="target"'
*/
