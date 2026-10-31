const isDev = false;
let R;
if (isDev) R = "http://localhost";
else if (!isDev) R = "https://example.com";
else R = "neither";
console.log(R);
