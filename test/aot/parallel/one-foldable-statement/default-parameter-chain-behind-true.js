const isDev = true;
function f(a = isDev, b = a ? "http://localhost" : "https://example.com") {
  return b;
}
const R = f();
console.log(R);
