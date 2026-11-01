const isDev = true;
const R = { base: 1, ...(isDev && { a: "http://localhost" }) };
console.log(R);
