const isDev = false;
const R = (function () {
  return isDev ? "http://localhost" : "https://example.com";
})();
console.log(R);
