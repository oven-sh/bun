const isDev = true;
let R = "https://example.com";
do {
  if (isDev) R = "http://localhost";
} while (false);
console.log(R);
