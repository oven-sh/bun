const isDev = false;
if (!isDev && isDev) throw new Error("impossible");
const R = isDev ? "http://localhost" : "https://example.com";
console.log(R);
