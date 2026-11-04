const isDev = true;
const { x = isDev ? "http://localhost" : "https://example.com" } = {};
const R = x;
console.log(R);
