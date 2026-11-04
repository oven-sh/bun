// A literal with a setter is stored under `prototype` of a constructor function: the setter runs with the instances as `this`, and with the literal itself. It stores a text where the instances list a number.
function Meter(raw) { this.raw = raw; this.seen = 0; }
Meter.prototype = { seen: 0, set value(next) { this.seen = "s" + next; } };
function touch(held, next) { held.value = next; return typeof held.seen; }
const first = new Meter(1), second = new Meter(2);
console.log(touch(first, 5), typeof second.seen, touch(second, 6), touch(Meter.prototype, 7), first.seen + 1, second.seen + 1, Meter.prototype.seen + 1);
