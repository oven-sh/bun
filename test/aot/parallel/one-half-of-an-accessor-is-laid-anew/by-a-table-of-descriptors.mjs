const log = [];
function make(start) { return { held: start, get x() { return this.held + 1; }, set x(v) { log.push("first " + v); this.held = v; } }; }
const one = make(JSON.parse("1")), two = make(JSON.parse("10"));
Object.defineProperties(one, { x: { set(v) { log.push("second " + v); this.held = v * 2; } } });
one.x = 5; two.x = 6;
console.log(`SAID ${one.x} ${two.x} ${Object.keys(one).join("+")} ${typeof Object.getOwnPropertyDescriptor(one, "x").get} ${log.join()}`);
