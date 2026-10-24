// Species: programs y method replaced through constructor. It prints what plain Bun prints.
class Meter { measure(): string { return "first"; } static unit(): string { return "m"; } }
const held: any[] = JSON.parse("[]");
held.push(new Meter());
held[0].constructor.prototype.measure = function (): string { return "replaced"; };
held[0].constructor.unit = function (): string { return "ft"; };
console.log(new Meter().measure(), Meter.unit());
