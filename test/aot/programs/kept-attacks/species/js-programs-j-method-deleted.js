// Species: js programs j method deleted. It prints what plain Bun prints.
const log = [];
class Base { measure() { return "base"; } }
class Meter extends Base { measure() { return "first"; } }
const held = JSON.parse("[]");
held.push(new Meter());
delete Object.getPrototypeOf(held[0]).measure;
log.push(new Meter().measure());
console.log(log.join("; "));
