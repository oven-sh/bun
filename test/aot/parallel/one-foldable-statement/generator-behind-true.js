const isDev = true;
function* g() {
  if (isDev) yield "http://localhost";
  yield "https://example.com";
}
const R = [...g()];
console.log(R);
