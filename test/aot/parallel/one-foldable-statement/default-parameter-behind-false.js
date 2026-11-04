const isDev = false;
function f(x = isDev ? "http://localhost" : "https://example.com") {
  return x;
}
const R = f();
console.log(R);
