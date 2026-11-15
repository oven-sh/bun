// In turn five of ten one object of each class gets a function of its own under the name of a method.
// From there on that object answers with its own function, and the other objects go on finding the method.
function Counter(start) { this.total = start; }
Counter.prototype.step = function () { this.total += 1; return this.total; };
class Meter { constructor(start) { this.total = start; } step() { this.total += 2; return this.total; } }
function runCounter(object) { var sum = 0; for (var i = 0; i < 100; i++) sum = (sum + object.step()) | 0; return sum; }
function runMeter(object) { var sum = 0; for (var i = 0; i < 100; i++) sum = (sum + object.step()) | 0; return sum; }
var plainCounter = new Counter(0), oddCounter = new Counter(0), plainMeter = new Meter(0), oddMeter = new Meter(0), printed = [];
for (var turn = 0; turn < 10; turn++) {
    if (turn === 5) {
        oddCounter.step = function () { return -1; };
        oddMeter.step = function () { return -2; };
    }
    printed.push(runCounter(plainCounter), runCounter(oddCounter), runMeter(plainMeter), runMeter(oddMeter));
}
console.log(printed.join(" "));
console.log(Object.keys(plainCounter).join(), Object.keys(oddCounter).join(), Object.keys(plainMeter).join(), Object.keys(oddMeter).join());
