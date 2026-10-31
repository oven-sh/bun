const isDev = false;
const get = () => isDev;
const R = get() ? "http://localhost" : "https://example.com";
console.log(R);
