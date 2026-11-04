// Reference: bun build --compile
// The text that a message quotes is held to the executable that `bun build --compile` makes without --aot, not to `bun run` (11-02).
// `bun <file>` puts the value of a constant where its name stands, and quotes 'null.x' here.
function receiver() {
  const holder = null;
  return holder.x;
}
try {
  receiver();
} catch (error) {
  console.log(error.message);
}
