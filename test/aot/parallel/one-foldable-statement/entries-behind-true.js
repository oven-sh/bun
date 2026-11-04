const isDev = true;
const R = Object.entries({ a: isDev ? "http://localhost" : "https://example.com" }).length;
console.log(R);
