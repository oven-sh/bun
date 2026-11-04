const isDev = false;
const R = typeof (isDev ? "http://localhost" : "https://example.com");
console.log(R);
