const isDev = true;
const R = { ...(isDev ? { a: "http://localhost" } : { b: "https://example.com" }) };
console.log(R);
