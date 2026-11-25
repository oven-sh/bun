// In turn five of ten text that is evaluated in the run lays a function on one object of each class, under a key that is put together in the run.
// The build sees no store under the name of the method. The other objects of the two classes, and the objects of the classes below them, go on finding the method.
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
var lay = new Function("object", "key", "value", "object[key] = value;");
var key = ["st", "ep"].join("");
var plainCounter = new Counter(0), oddCounter = new Counter(0), ticker = new Ticker(0), plainMeter = new Meter(0), oddMeter = new Meter(0), gauge = new Gauge(0), printed = [];
for (var turn = 0; turn < 10; turn++) {
    if (turn === 5) {
        lay(oddCounter, key, function () { return -1; });
        lay(oddMeter, key, function () { return -2; });
    }
    printed.push(runCounter(plainCounter), runCounter(oddCounter), runTicker(ticker), runMeter(plainMeter), runMeter(oddMeter), runGauge(gauge));
}
console.log(printed.join(" "));
console.log(Object.keys(oddCounter).join(), Object.keys(ticker).join(), Object.keys(oddMeter).join(), Object.keys(gauge).join());
