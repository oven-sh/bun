const isDev = false;
const R = [isDev ? "http://localhost" : "https://example.com", isDev && "http://localhost", isDev || "https://example.com", !isDev, isDev ? 1 : 2, `${isDev ? "a" : "b"}`];
console.log(R);
