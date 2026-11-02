// A name whose `--define` value is the name of a variable does nothing alone in a statement, as the variable written there does nothing: `bun run` leaves the statement out, the `return` behind it is then right behind the `const` that it returns, and the initializer of that `const` is in tail position.
// Flags: --define SEEN=n
function loop(n) {
  if (n === 0) return "done";
  const last = loop(n - 1);
  SEEN;
  return last;
}
console.log(loop(1e6));
