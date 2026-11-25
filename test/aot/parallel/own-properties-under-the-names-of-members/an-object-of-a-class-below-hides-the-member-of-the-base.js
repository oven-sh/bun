// The method is a member of the class above. In turn five of ten one object of the class below gets a function of its own under its name.
// The other object of the class below and the object of the class above go on finding the method.
function Counter(start) { this.total = start; }
Counter.prototype.step = function () { this.total += 1; return this.total; };
function Ticker(start) { Counter.call(this, start); }
Object.setPrototypeOf(Ticker.prototype, Counter.prototype);
class Meter { constructor(start) { this.total = start; } step() { this.total += 2; return this.total; } }
class Gauge extends Meter { }
function runCounter(object) { var sum = 0; for (var i = 0; i < 100; i++) sum = (sum + object.step()) | 0; return sum; }
function runTicker(object) { var sum = 0; for (var i = 0; i < 100; i++) sum = (sum + object.step()) | 0; return sum; }
function runMeter(object) { var sum = 0; for (var i = 0; i < 100; i++) sum = (sum + object.step()) | 0; return sum; }
function runGauge(object) { var sum = 0; for (var i = 0; i < 100; i++) sum = (sum + object.step()) | 0; return sum; }
var counter = new Counter(0), plainTicker = new Ticker(0), oddTicker = new Ticker(0), meter = new Meter(0), plainGauge = new Gauge(0), oddGauge = new Gauge(0), printed = [];
for (var turn = 0; turn < 10; turn++) {
    if (turn === 5) {
        oddTicker.step = function () { return -1; };
        oddGauge.step = function () { return -2; };
    }
    printed.push(runCounter(counter), runTicker(plainTicker), runTicker(oddTicker), runMeter(meter), runGauge(plainGauge), runGauge(oddGauge));
}
console.log(printed.join(" "));
console.log(Object.keys(plainTicker).join(), Object.keys(oddTicker).join(), Object.keys(plainGauge).join(), Object.keys(oddGauge).join());
