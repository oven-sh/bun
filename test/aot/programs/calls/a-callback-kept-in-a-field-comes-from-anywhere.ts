// The field of a class has a function type. What is stored there comes from typed code, from a parameter whose caller no type describes, and from text that is evaluated.
// Every one of them satisfies the type, is kept, is the same function when it is read again, and is called with the receiver that a call of a member has.
type Listener = (this: unknown, value: number) => number;
class Holder {
  listener: Listener;
  calls = 0;
  constructor(listener: Listener) { this.listener = listener; }
  fire(value: number): number { this.calls++; return this.listener(value); }
}
const launder = new Function("value", "return value") as <V>(value: V) => V;
const listeners: Listener[] = [
  value => value + 1,
  value => value * 2,
  function (this: unknown, value: number) { return this instanceof Holder ? value - 1 : -1; },
  launder(new Function("value", "return value * value") as Listener),
  launder(Math.abs as Listener),
  launder(((a: number) => a + 100).bind(null) as Listener),
];
let total = 0;
for (let round = 0; round < 50; round++) {
  for (const listener of listeners) {
    const holder = new Holder(listener);
    total = (total + holder.fire(round - 25)) % 1000003;
    if (holder.listener !== listener) console.log("another function");
    holder.listener = listeners[(round + 1) % listeners.length];
    total = (total + holder.fire(round)) % 1000003;
  }
}
console.log(total);
const holder = new Holder(listeners[0]);
for (const listener of listeners) {
  holder.listener = listener;
  console.log(holder.fire(-3), holder.listener === listener, Object.keys(holder).join());
}
