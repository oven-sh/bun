// The only argument that is ever bound is one literal string, so the closure of the bound function holds it in the form that such a type has. `new bound()` goes through the run time, which hands it on as a value.
function hide(value) { return value; }
const seen = [];
const Meter = hide(function Meter(size) { this.size = size; seen.push(hide(size)); this.text = [size].join("+") + String(size).length; });
Meter.prototype.read = function () { return this.size + "/" + this.text; };
const bound = Meter.bind({ size: "ignored" }, "bound");
const made = new bound();
const again = Reflect.construct(bound, []);
console.log(made.read(), again.read(), seen.join(), seen.map(each => typeof each).join(), JSON.stringify(made));
