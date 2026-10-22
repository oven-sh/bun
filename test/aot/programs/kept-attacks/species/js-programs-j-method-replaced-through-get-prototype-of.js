// Species: js programs j method replaced through get prototype of. It prints what plain Bun prints.
const log = [];
class Meter { measure() { return "first"; } }
const held = JSON.parse("[]");
held.push(new Meter());
Object.getPrototypeOf(held[0]).measure = function () { return "replaced"; };
log.push(new Meter().measure());
console.log(log.join("; "));
