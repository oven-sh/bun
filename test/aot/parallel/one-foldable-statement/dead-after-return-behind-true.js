const isDev = true;
function f() {
  return isDev ? "http://localhost" : "https://example.com";
  return "never";
}
const R = f();
console.log(R);
