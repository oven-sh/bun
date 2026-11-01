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
