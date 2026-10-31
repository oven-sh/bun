// A `--define` whose value is `eval` is the global function wherever the defined name is not called by itself: each of these calls runs its text outside the function.
// Flags: --define RUN=eval
function read() {
  var local = "the local";
  const run = RUN;
  // prettier-ignore
  return [(0, RUN)("typeof local"), RUN?.("typeof local"), run("typeof local"), RUN.call(null, "typeof local"), String(RUN`typeof local`), typeof RUN, RUN === eval].join();
}
console.log(read());
