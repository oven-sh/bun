const isDev = true;
let R;
try {
  R = isDev ? "http://localhost" : "https://example.com";
} finally {
}
console.log(R);
