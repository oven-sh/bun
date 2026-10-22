// A constructor that is called without `new` throws before its body runs. A class names itself a class constructor. `Promise`, which the engine writes in JavaScript as a function that can only be constructed, names itself a constructor.
function said(f) { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const hide = value => [value].map(held => held)[0];

class Named {}
const Inferred = class {};
class Derived extends Promise {}
let ran = 0;
const executor = () => { ran++; };

row("Promise()", () => Promise());
row("Promise(executor)", () => Promise(executor));
row("Promise.call(a promise, executor)", () => Promise.call(Promise.resolve(1), executor));
row("Reflect.apply(Promise)", () => Reflect.apply(Promise, undefined, [executor]));
row("Promise through a variable", () => hide(Promise)(executor));
row("Promise as a method", () => ({ Promise }).Promise(executor));
row("the executor did not run", () => ran);
row("a class", () => Named());
row("a class through a variable", () => hide(Named)());
row("a class whose name is inferred", () => Inferred());
row("a subclass of Promise", () => Derived(executor));
row("new Promise(executor)", () => new Promise(executor) instanceof Promise);
row("new Derived(executor)", () => new Derived(executor) instanceof Derived);
row("Reflect.construct(Promise)", () => Reflect.construct(Promise, [executor], Derived) instanceof Derived);
row("the executor ran", () => ran);
row("new Promise()", () => new Promise());
