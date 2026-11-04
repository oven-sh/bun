const isDev = true;
class P {
  constructor(v) {
    this.v = v;
  }
}
const R = new P(isDev ? "http://localhost" : "https://example.com").v;
console.log(R);
