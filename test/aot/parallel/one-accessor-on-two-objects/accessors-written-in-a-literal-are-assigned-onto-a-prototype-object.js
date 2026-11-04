// Object.defineProperties with the descriptors of a literal lays its pair on the prototype object of a class: the same functions run with the literal and with the instances as `this`.
const source = { seen: 0, set value(next) { this.seen = "s" + next; } };
class Meter { raw = 0; seen = 0; }
Object.defineProperties(Meter.prototype, Object.getOwnPropertyDescriptors(source));
function touch(held, next) { held.value = next; return typeof held.seen; }
const first = new Meter();
console.log(touch(first, 5), touch(source, 6), first.seen + 1, source.seen + 1, Object.hasOwn(first, "value"));
