const isDev = true;
function id(x) {
  return x;
}
const R = [id(isDev ? "http://localhost" : "https://example.com"), id("http://localhost")];
console.log(R);
