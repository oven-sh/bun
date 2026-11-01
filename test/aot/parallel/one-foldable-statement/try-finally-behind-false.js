const isDev = false;
let R;
try {
  R = isDev ? "http://localhost" : "https://example.com";
} finally {
}
console.log(R);
