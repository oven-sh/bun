// A call of a name whose `--define` value is a path throws what plain Bun throws where the last name of the path holds no function: the message names the whole path.
// Flags: --define MISSING=holder.inner.missing --define COUNT=holder.count
const holder = { inner: {}, count: 1 };
try {
  MISSING();
} catch (error) {
  console.log(error.message);
}
try {
  COUNT();
} catch (error) {
  console.log(error.message);
}
