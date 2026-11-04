const isDev = true;
const c1 = isDev ? "http://localhost" : "https://example.com";
const c2 = c1;
const c3 = [c2];
const R = c3[0];
console.log(R);
