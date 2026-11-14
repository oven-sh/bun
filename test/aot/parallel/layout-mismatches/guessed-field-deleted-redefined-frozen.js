// The field is deleted above a property of the same name on the prototype, added again, frozen, and made an accessor.
const log = [];
function Node1() { this.next = null; this.kept = null; }
Node1.prototype.next = "inherited";
const a = new Node1(), b = new Node1(), c = new Node1();
a.next = b; a.kept = c; delete a.next; log.push(a.next, "next" in a, Object.keys(a).join());
a.next = c; log.push(a.next === c, Object.keys(a).join());
Object.freeze(b); try { "use strict"; b.next = a; } catch (error) { log.push(error.constructor.name); } log.push(b.next);
Object.defineProperty(c, "next", { set(v) { log.push("set " + typeof v); }, get() { return 5; }, configurable: true }); c.next = a; log.push(c.next);
console.log(log.join("; "));
