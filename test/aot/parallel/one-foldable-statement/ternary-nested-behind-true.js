const isDev = true;
const R = isDev ? "http://localhost" : isDev ? "https://example.com" : "http://localhost";
console.log(R);
