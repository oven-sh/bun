const isDev = true;
const o = {
  dev: isDev,
  value() {
    return this.dev ? "http://localhost" : "https://example.com";
  },
};
const R = o.value();
console.log(R);
