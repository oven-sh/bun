const isDev = true;
class C {
  v = isDev ? "http://localhost" : "https://example.com";
}
const R = new C().v;
console.log(R);
