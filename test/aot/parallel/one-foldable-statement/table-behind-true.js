const isDev = true;
const table = { true: "http://localhost", false: "https://example.com" };
const R = table[String(Boolean(isDev))];
console.log(R);
