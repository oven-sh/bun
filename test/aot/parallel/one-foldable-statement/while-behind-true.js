const isDev = true;
let R = "https://example.com";
while (isDev) {
  R = "http://localhost";
  break;
}
console.log(R);
