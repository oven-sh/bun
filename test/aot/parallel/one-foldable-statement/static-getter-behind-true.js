const isDev = true;
class C {
  static get v() {
    return isDev ? "http://localhost" : "https://example.com";
  }
}
const R = C.v;
console.log(R);
