// `#x`, `#m()` and `#x in o` as TypeScript writes them for a target below ES2022: a WeakMap or a WeakSet a name, reached through three helpers.
import { __classPrivateFieldGet, __classPrivateFieldSet, __classPrivateFieldIn } from "./helpers.mjs";
var _Counter_x, _Counter_label, _Counter_instances, _Counter_step;
class Counter {
    constructor(start) {
        _Counter_instances.add(this);
        _Counter_x.set(this, start);
        _Counter_label.set(this, void 0);
    }
    read() { return __classPrivateFieldGet(this, _Counter_x, "f"); }
    write(v) { return __classPrivateFieldSet(this, _Counter_x, v, "f"); }
    bump() { var _a; return __classPrivateFieldSet(this, _Counter_x, (_a = __classPrivateFieldGet(this, _Counter_x, "f"), ++_a), "f"); }
    label() { return __classPrivateFieldGet(this, _Counter_label, "f"); }
    name(text) { __classPrivateFieldSet(this, _Counter_label, text, "f"); return this; }
    step() { return __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_step).call(this, 2); }
    static is(o) { return __classPrivateFieldIn(_Counter_x, o); }
    static marked(o) { return __classPrivateFieldIn(_Counter_instances, o); }
}
_Counter_x = new WeakMap(), _Counter_label = new WeakMap(), _Counter_instances = new WeakSet(), _Counter_step = function _Counter_step(by) {
    return this.write(this.read() + by);
};
class Below extends Counter {
    constructor() { super(100); this.own = true; }
}
const says = action => {
    try {
        return action();
    } catch (error) {
        return error.constructor.name + ": " + error.message;
    }
};
const counter = new Counter(1), below = new Below();
console.log(counter.read(), counter.write(5), counter.read(), counter.bump(), counter.step(), counter.read());
console.log(counter.label(), counter.name("first").label(), below.read(), below.step(), below.own, Object.keys(below).join());
console.log(Counter.is(counter), Counter.is(below), Counter.is({}), Counter.marked(counter), Counter.marked({}), says(() => Counter.is(1)));
console.log(says(() => Counter.prototype.read.call({})));
console.log(says(() => Counter.prototype.write.call({}, 1)));
console.log(says(() => Counter.prototype.step.call({})));
console.log(says(() => Counter.prototype.read.call(null)));
let sum = 0;
for (let round = 0; round < 1000; round++) {
    const one = new Counter(round);
    one.bump();
    sum += one.read() + one.step();
}
console.log(sum, JSON.stringify(counter), Object.getOwnPropertyNames(counter).length, Reflect.ownKeys(counter).length);
const frozen = Object.freeze(new Counter(7));
console.log(frozen.read(), frozen.write(8), frozen.read(), Object.isFrozen(frozen));
