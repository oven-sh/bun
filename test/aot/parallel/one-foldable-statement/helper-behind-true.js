const isDev = true;
function pick(c, a, b) {
  return c ? a : b;
}
const R = pick(isDev, "http://localhost", "https://example.com");
console.log(R);
