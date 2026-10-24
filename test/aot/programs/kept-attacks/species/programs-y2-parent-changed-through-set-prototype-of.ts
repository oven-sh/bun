// Species: programs  parent changed through set prototype of. It prints what plain Bun prints.
const log: string[] = [];
class Base { measure(): string { return "base"; } }
class Meter extends Base {}
const held: any[] = JSON.parse("[]");
held.push(new Meter());
Object.setPrototypeOf(Object.getPrototypeOf(held[0]), { measure(): string { return "other"; } });
log.push(new Meter().measure());
console.log(log.join("; "));
