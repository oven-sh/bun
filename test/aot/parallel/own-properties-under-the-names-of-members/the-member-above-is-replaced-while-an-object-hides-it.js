// One object of each class hides a method from its birth on. In turn five of ten the method itself is replaced on the prototype object.
// The objects that hide nothing find the new function from there on, and the object that hides goes on answering with its own; in turn eight it loses its own function and finds the new one too.
function Counter(start, special) { this.total = start; if (special) this.step = function () { return -1; }; }
Counter.prototype.step = function () { this.total += 1; return this.total; };
class Meter { constructor(start, special) { this.total = start; if (special) this.step = function () { return -2; }; } step() { this.total += 2; return this.total; } }
function runCounter(object) { var sum = 0; for (var i = 0; i < 100; i++) sum = (sum + object.step()) | 0; return sum; }
function runMeter(object) { var sum = 0; for (var i = 0; i < 100; i++) sum = (sum + object.step()) | 0; return sum; }
var plainCounter = new Counter(0, false), oddCounter = new Counter(0, true), plainMeter = new Meter(0, false), oddMeter = new Meter(0, true), printed = [];
for (var turn = 0; turn < 10; turn++) {
    if (turn === 5) {
        Counter.prototype.step = function () { this.total += 10; return this.total; };
        Meter.prototype.step = function () { this.total += 20; return this.total; };
    }
    if (turn === 8) {
        delete oddCounter.step;
        delete oddMeter.step;
    }
    printed.push(runCounter(plainCounter), runCounter(oddCounter), runMeter(plainMeter), runMeter(oddMeter));
}
console.log(printed.join(" "));
