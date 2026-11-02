// Where a `--define` whose value is one name spells the only use of a `const`, `bun run` prints the initializer of the `const` there: the TypeError of a call of a member that is missing names the path of the initializer, not the defined name.
// Flags: --define NAME=target
const holder = { inner: {} };
function call() {
  const target = holder.inner;
  return NAME.missing();
}
try {
  call();
} catch (error) {
  console.log(error.message);
}
