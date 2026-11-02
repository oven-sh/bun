// Where a `--define` whose value is one name spells the only use of a `const`, the TypeError of a call of a member that is missing quotes the call with the initializer of the `const` in place of the defined name and with its arguments, also where the value is longer than the defined name.
// Flags: --define NAME=target
const holder = { inner: {} };
function call() {
  const target = holder.inner;
  return NAME.missing(1, holder);
}
try {
  call();
} catch (error) {
  console.log(error.message);
}
