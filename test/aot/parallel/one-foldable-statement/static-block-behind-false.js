const isDev = false;
class C {
  static v;
  static {
    C.v = isDev ? "http://localhost" : "https://example.com";
  }
}
const R = C.v;
console.log(R);
