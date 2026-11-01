const isDev = true;
const o = isDev ? { v: "http://localhost" } : null;
const R = o?.v ?? "https://example.com";
console.log(R);
