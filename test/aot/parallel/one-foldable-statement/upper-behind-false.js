const isDev = false;
const R = String(isDev ? "http://localhost" : "https://example.com").toUpperCase();
console.log(R);
