const isDev = false;
const tag = (s, v) => s[0] + String(v);
const R = tag`v=${isDev ? "http://localhost" : "https://example.com"}`;
console.log(R);
