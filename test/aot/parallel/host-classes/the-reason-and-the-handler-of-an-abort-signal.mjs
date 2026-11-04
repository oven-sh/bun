// The reason is what the signal was handed or an error that the host has made; the handler is the object that was stored last, or null.
function made() { return AbortSignal.abort().reason; }
console.log(made().name, made() instanceof DOMException, made().message, made().code);
function handed() { return AbortSignal.abort({ why: 41 }).reason; }
console.log(handed().why, typeof handed());
function number() { return AbortSignal.abort(7).reason; }
console.log(number() + 1);
const controller = new AbortController();
function before() { return controller.signal.reason; }
console.log(before());
function handler() { return controller.signal.onabort; }
console.log(handler());
controller.signal.onabort = function (event) { console.log("aborted", event.type, this === controller.signal); };
console.log(typeof handler(), handler().length);
controller.signal.onabort = 5; console.log(handler());
controller.signal.onabort = event => console.log("second", event.type);
controller.abort(new RangeError("r"));
console.log(before().name, before() instanceof RangeError);
try { Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason").get.call({}); } catch (error) { console.log(error.name); }
console.log(Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason").set, typeof Object.getOwnPropertyDescriptor(AbortSignal.prototype, "onabort").set);
const timed = AbortSignal.timeout(1); await new Promise(resolve => setTimeout(resolve, 20));
function late() { return timed.reason; }
console.log(late().name, late() instanceof DOMException);
