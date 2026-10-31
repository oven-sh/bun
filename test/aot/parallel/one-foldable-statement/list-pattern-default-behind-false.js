const isDev = false;
const [x = "http://localhost", y = "https://example.com"] = [isDev ? undefined : "https://example.com"];
const R = [x, y];
console.log(R);
