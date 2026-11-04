const isDev = true;
const G = isDev ? true : false;
const H = G ? 1 : 0;
const R = H === 1 ? "http://localhost" : "https://example.com";
console.log(R);
