const isDev = false;
let R;
if (isDev) {
  R = "http://localhost";
} else {
  R = "https://example.com";
}
console.log(R);
