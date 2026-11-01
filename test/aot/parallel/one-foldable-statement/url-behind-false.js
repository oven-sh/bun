const isDev = false;
const base = isDev ? "http://localhost:3000" : "https://example.com";
const R = new URL("/api", base).href;
console.log(R);
