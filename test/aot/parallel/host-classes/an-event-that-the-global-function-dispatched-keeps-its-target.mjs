// Whatever the global function is called on, the listeners of the global object run. The target that the event keeps is no global object: an object of the host stands for it.
const seen = [];
addEventListener("ping", event => seen.push(event.target === event.currentTarget, event.target === globalThis, event.type));
function send(event) { return dispatchEvent(event); }
const first = new Event("ping");
console.log(send(first), typeof first.target, first.target === globalThis, first.target instanceof EventTarget, first.currentTarget);
addEventListener("ping", event => event.preventDefault());
const refused = new Event("ping", { cancelable: true });
console.log(send(refused), refused.defaultPrevented, typeof send(new Event("nobody listens")));
const borrowed = dispatchEvent;
const other = new Event("ping");
console.log(borrowed.call({ other: 1 }, other), other.target === first.target, typeof other.target.addEventListener, seen.join());
for (const odd of [undefined, null, 1, "ping", {}, []]) try { console.log(dispatchEvent(odd)); } catch (error) { console.log(error.name); }
try { dispatchEvent(); } catch (error) { console.log(error.name); }
class Holder { target = first.target; answer = dispatchEvent(new Event("ping")); }
console.log(new Holder().target === other.target, new Holder().answer, new Event("never sent").target);
