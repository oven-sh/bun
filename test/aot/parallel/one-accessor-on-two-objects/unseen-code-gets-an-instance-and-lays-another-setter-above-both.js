// One setter of a class stands above the instances of two classes. Unseen code gets one instance, climbs from it and lays another setter above both.
class Base { set value(next) { this.seen = next; } }
class Wide extends Base { raw = 0; more = 1; }
class Narrow extends Base { low = 0; }
const handedOut = new Wide(), kept = new Narrow();
function touch(held, next) { held.value = next; return typeof held.seen + typeof held.other; }
console.log(touch(handedOut, 1), touch(kept, 2));
globalThis.handed = handedOut;
(0, eval)("Object.defineProperty(Object.getPrototypeOf(Object.getPrototypeOf(handed)), 'value', { set(next) { this.other = next; }, configurable: true })");
console.log(touch(handedOut, 3), touch(kept, 4));
