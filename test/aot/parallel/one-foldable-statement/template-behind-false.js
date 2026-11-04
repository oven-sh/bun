const isDev = false;
const R = `${isDev ? "http://localhost" : "https://example.com"}/path`;
console.log(R);
