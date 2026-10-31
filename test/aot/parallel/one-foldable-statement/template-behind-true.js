const isDev = true;
const R = `${isDev ? "http://localhost" : "https://example.com"}/path`;
console.log(R);
