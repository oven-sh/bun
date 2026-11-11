const log = [];
class Holder { constructor(start) { this.held = start; Object.defineProperty(this, "x", { get() { return this.held + 1; }, set(v) { log.push("first " + v); this.held = v; }, configurable: true, enumerable: true }); } }
const one = new Holder(JSON.parse("1")), two = new Holder(JSON.parse("10"));
Object.defineProperty(one, "x", { set(v) { log.push("second " + v); this.held = v * 2; } });
one.x = 5; two.x = 6;
for (let i = 0; i < 3; i++) Object.defineProperty(two, "x", { get() { return this.held + i; } });
console.log(`SAID ${one.x} ${two.x} ${Object.keys(one).join("+")} ${typeof Object.getOwnPropertyDescriptor(one, "x").get} ${log.join()}`);
