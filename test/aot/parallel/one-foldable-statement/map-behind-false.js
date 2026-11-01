const isDev = false;
const m = new Map([
  [true, "http://localhost"],
  [false, "https://example.com"],
]);
const R = m.get(Boolean(isDev));
console.log(R);
