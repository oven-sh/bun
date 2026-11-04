const isDev = true;
const config = Object.freeze({ dev: isDev, a: "http://localhost", b: "https://example.com" });
const R = config.dev ? config.a : config.b;
console.log(R);
