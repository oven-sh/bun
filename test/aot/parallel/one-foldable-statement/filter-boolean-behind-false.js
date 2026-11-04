const isDev = false;
const R = [isDev && "http://localhost", "https://example.com"].filter(Boolean);
console.log(R);
