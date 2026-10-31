const isDev = false;
const R = "x" + String(isDev ? "http://localhost" : "https://example.com");
console.log(R);
