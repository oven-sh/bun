const isDev = true;
let R = "https://example.com";
out: {
  if (!isDev) break out;
  R = "http://localhost";
}
console.log(R);
