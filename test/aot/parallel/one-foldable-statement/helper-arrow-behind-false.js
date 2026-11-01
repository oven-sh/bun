const isDev = false;
const pick = (c) => (c ? "http://localhost" : "https://example.com");
const R = pick(isDev);
console.log(R);
