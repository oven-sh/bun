// Species: programs  method deleted through get prototype of. It prints what plain Bun prints.
const log: string[] = [];
class Base { measure(): string { return "base"; } }
class Meter extends Base { measure(): string { return "first"; } }
const held: any[] = JSON.parse("[]");
held.push(new Meter());
delete Object.getPrototypeOf(held[0]).measure;
log.push(new Meter().measure());
console.log(log.join("; "));
