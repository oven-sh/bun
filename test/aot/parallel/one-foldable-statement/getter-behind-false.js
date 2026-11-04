const isDev = false;
const o = {
  get v() {
    return isDev ? "http://localhost" : "https://example.com";
  },
};
const R = o.v;
console.log(R);
