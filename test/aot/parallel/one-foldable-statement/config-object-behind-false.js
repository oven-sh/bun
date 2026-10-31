const isDev = false;
const config = { dev: isDev, value: isDev ? "http://localhost" : "https://example.com" };
const R = config.value;
console.log(R);
