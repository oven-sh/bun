// Species: programs  method replaced through proto. It prints what plain Bun prints.
const log: string[] = [];
class Meter { measure(): string { return "first"; } }
const held: any[] = JSON.parse("[]");
held.push(new Meter());
held[0].__proto__.measure = function (): string { return "replaced"; };
log.push(new Meter().measure());
console.log(log.join("; "));
