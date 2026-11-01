const isDev = true;
function value() {
  return isDev ? "http://localhost" : "https://example.com";
}
const R = value();
console.log(R);
