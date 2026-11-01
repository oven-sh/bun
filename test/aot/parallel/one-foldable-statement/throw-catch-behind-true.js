const isDev = true;
let R;
try {
  if (!isDev) throw "https://example.com";
  R = "http://localhost";
} catch (e) {
  R = e;
}
console.log(R);
