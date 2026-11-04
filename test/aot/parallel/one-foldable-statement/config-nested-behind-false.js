const isDev = false;
const config = { env: { dev: isDev } };
const R = config.env.dev ? "http://localhost" : "https://example.com";
console.log(R);
