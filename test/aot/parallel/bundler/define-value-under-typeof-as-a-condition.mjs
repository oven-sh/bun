// `typeof` of a name with a `--define` value reads the binding that the value names also where only the truth of its answer is used: below `!` and in the test of `if` or of `?:`. Above the declaration of the `let` it throws a ReferenceError, as `typeof` of the name does. `bun run` does not evaluate such a `typeof`. Plain Bun prints another output.
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
/* Output:
ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError
*/
