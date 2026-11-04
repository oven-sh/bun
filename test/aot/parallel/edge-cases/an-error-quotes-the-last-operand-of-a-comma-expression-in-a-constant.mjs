// Reference: bun build --compile
// The text that a message quotes is held to the executable that `bun build --compile` makes without --aot, not to `bun run` (11-02).
// The value of a comma expression in brackets is printed in the place of the constant that holds it, without the operand in front.
const isDev = false;
const devUrl = "http://localhost";
const R = (isDev, devUrl);
try {
  null[String(R)];
} catch (e) {
  console.log(e.message);
}
