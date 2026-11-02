// Where a member whose `--define` value is one name spells the only use of a `const`, `bun run` prints the initializer of the `const` there: the TypeError of a read from a member that is missing quotes the path of the initializer, not the value of the define.
// Flags: --define process.env.PART=part
const holder = { inner: {} };
function read() {
  const part = holder.inner;
  return process.env.PART.missing.deeper;
}
try {
  read();
} catch (error) {
  console.log(error.message);
}
