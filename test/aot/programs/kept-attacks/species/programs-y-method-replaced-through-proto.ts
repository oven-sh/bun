// Species: programs y method replaced through proto. It prints what plain Bun prints.
class Meter { measure(): string { return "first"; } }
const held: any[] = JSON.parse("[]");
held.push(new Meter());
held[0].__proto__.measure = function (): string { return "replaced"; };
console.log(new Meter().measure());
