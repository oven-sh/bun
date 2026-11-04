// Reference: bun build --compile
// The text that a message quotes is held to the executable that `bun build --compile` makes without --aot, not to `bun run` (11-02).
// Of `a ? b : a ? c : b` with `a` false `bun run` prints the first `b`, and an error quotes its value in the place of the constant.
const isDev = false;
const devUrl = "http://localhost";
const prodUrl = "https://example.com";
const R = isDev ? devUrl : isDev ? prodUrl : devUrl;
try {
  null[String(R)];
} catch (e) {
  console.log(e.message);
}
