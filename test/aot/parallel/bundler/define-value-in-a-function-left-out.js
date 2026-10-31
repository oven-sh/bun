// A function that the executable leaves out is not compiled: a `--define` that stops the build where it runs is no error inside it.
// Flags: --define RUN=eval --define ROOT=inner.length
function never() {
  const inner = "abcde";
  return [RUN("typeof inner"), ROOT];
}
console.log("ran");
