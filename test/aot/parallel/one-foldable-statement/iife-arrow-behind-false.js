const isDev = false;
const R = (() => (isDev ? "http://localhost" : "https://example.com"))();
console.log(R);
