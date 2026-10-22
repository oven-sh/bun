// Callbacks handed over: a listener typed for CustomEvent<number> is called with whatever was dispatched under that name: a plain Event, a detail of another type, a subclass; `this` is the target.
let total = 0;

function onValue(this: unknown, event: CustomEvent<number>): void {
  total += typeof event.detail === "number" ? event.detail : typeof event.detail === "string" ? 100 : event.detail === undefined ? 10000 : event.detail === null ? 1000000 : 100000000;
  total += this instanceof EventTarget ? 1000000000 : 0;
}

class Loud extends Event {
  detail = ["loud"];
}

onValue.call(null, new CustomEvent("value", { detail: 1 }));
const target = new EventTarget();
target.addEventListener("value", onValue as EventListener);
target.dispatchEvent(new CustomEvent("value", { detail: 2 }));
target.dispatchEvent(new CustomEvent("value", { detail: "two" }));
target.dispatchEvent(new Event("value"));
target.dispatchEvent(new CustomEvent("value"));
target.dispatchEvent(new Loud("value"));
console.log(total);
