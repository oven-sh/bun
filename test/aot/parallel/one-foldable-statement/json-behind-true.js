const isDev = true;
const R = JSON.stringify({ v: typeof (isDev ? "http://localhost" : "https://example.com") });
console.log(R);
