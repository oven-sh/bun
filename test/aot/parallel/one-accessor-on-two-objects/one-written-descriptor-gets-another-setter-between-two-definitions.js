// One written descriptor is laid on two literals, and between the two definitions another function is stored under `set`.
const descriptor = { set(next) { this.seen = next; } };
const first = { raw: 0 }, second = { low: 0, more: 1 };
Object.defineProperty(first, "value", descriptor);
descriptor.set = function (next) { this.other = next; };
Object.defineProperty(second, "value", descriptor);
function touch(held, next) { held.value = next; return typeof held.seen + typeof held.other; }
console.log(touch(first, 5), touch(second, 6));
