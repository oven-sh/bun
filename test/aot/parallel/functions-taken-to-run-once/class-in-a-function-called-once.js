function setUp() {
  class Meter {
    static made = 0;
    constructor(n) { this.n = n; Meter.made++; }
    read() { return this.n * 2; }
  }
  return Meter;
}
const Meter = setUp();
console.log(new Meter(4).read(), new Meter(5).read(), Meter.made);
