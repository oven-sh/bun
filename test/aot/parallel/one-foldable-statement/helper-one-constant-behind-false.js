const isDev = false;
function wrap(x) {
  return [x];
}
const R = wrap(isDev ? "http://localhost" : "https://example.com");
console.log(R);
