const isDev = false;
const R = { ...(isDev ? { a: "http://localhost" } : { b: "https://example.com" }) };
console.log(R);
