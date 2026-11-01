const isDev = false;
let R = "https://example.com";
while (isDev) {
  R = "http://localhost";
  break;
}
console.log(R);
