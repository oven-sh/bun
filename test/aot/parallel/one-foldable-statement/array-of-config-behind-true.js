const isDev = true;
const R = [{ on: isDev, v: "http://localhost" }, { on: !isDev, v: "https://example.com" }].filter((x) => x.on).map((x) => x.v);
console.log(R);
