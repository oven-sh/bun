const isDev = false;
const R = ["https://example.com", "http://localhost"][Number(Boolean(isDev))];
console.log(R);
