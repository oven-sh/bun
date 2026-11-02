// Where a `--define` whose value is one name spells the only use of a `const`, the TypeError of a read from a member that is missing quotes the path with the initializer of the `const` in place of the defined name, also where the value is longer than the defined name.
// Flags: --define NAME=target
const holder = { inner: {} };
function read() {
  const target = holder.inner;
  return NAME.missing.deeper;
}
try {
  read();
} catch (error) {
  console.log(error.message);
}
