const isDev = true;
const R = (() => {
  if (isDev) return "http://localhost";
  return "https://example.com";
})();
console.log(R);
