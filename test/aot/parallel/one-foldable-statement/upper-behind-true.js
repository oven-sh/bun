const isDev = true;
const R = String(isDev ? "http://localhost" : "https://example.com").toUpperCase();
console.log(R);
