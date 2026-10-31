const isDev = false;
const { dev, a, b } = { dev: isDev, a: "http://localhost", b: "https://example.com" };
const R = dev ? a : b;
console.log(R);
