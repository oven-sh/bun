// Species: js programs j method replaced through proto. It prints what plain Bun prints.
const log = [];
class Meter { measure() { return "first"; } }
const held = JSON.parse("[]");
held.push(new Meter());
held[0].__proto__.measure = function () { return "replaced"; };
log.push(new Meter().measure());
console.log(log.join("; "));
