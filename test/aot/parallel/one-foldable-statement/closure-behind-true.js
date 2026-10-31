const isDev = true;
const get = () => isDev;
const R = get() ? "http://localhost" : "https://example.com";
console.log(R);
