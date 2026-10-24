// Species: programs y method replaced through get prototype of. It prints what plain Bun prints.
class Meter { measure(): string { return "first"; } }
const held: any[] = JSON.parse("[]");
held.push(new Meter());
Object.getPrototypeOf(held[0]).measure = function (): string { return "replaced"; };
console.log(new Meter().measure());
