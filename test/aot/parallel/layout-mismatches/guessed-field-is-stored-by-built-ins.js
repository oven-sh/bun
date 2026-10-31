// Object.assign, Reflect.set, Object.defineProperty and a loop over entries store into fields that the constructor fills with null; one becomes an accessor.
const log = [];
function Node1() { this.next = null; this.prev = null; this.up = null; this.down = null; }
const a = new Node1(), b = new Node1();
a.next = b;
Object.assign(a, { prev: "assigned" }); Reflect.set(a, "up", 3.5); Object.defineProperty(a, "down", { value: [9], writable: true, enumerable: true, configurable: true });
Object.assign(b, JSON.parse('{"next":{"parsed":1},"prev":[1]}')); Object.defineProperty(b, "up", { get() { return "getter"; }, configurable: true });
for (const [key, value] of Object.entries({ down: new Map([[1, 2]]) })) b[key] = value;
log.push(typeof a.next, a.prev.length, a.up + 1, a.down[0], b.next.parsed, b.prev[0], b.up, b.down.get(1), Object.keys(b).join());
console.log(log.join("; "));
