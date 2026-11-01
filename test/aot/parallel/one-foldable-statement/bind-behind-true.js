const isDev = true;
function f() {
  return this.dev ? "http://localhost" : "https://example.com";
}
const R = f.call({ dev: isDev });
console.log(R);
