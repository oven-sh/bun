// A call of a member whose `--define` value is `eval` is no direct call of `eval`: the evaluated text sees no variable of the function.
// Flags: --define process.env.RUN=eval
function f() {
  const local = "the local";
  return process.env.RUN("typeof local");
}
console.log(f());
