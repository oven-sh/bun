// Species: programs  method replaced through get prototype of. It prints what plain Bun prints.
const log: string[] = [];
class Meter { measure(): string { return "first"; } }
const held: any[] = JSON.parse("[]");
held.push(new Meter());
Object.getPrototypeOf(held[0]).measure = function (): string { return "replaced"; };
log.push(new Meter().measure());
console.log(log.join("; "));
