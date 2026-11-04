const isDev = false;
function f() {
  if (!isDev) return "https://example.com";
  return "http://localhost";
}
const R = f();
console.log(R);
