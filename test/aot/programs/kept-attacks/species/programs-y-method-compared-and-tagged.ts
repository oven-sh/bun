// Species: programs y method compared and tagged. It prints what plain Bun prints.
class Meter { measure(): string { return "first"; } }
const held: any[] = JSON.parse("[]");
held.push(new Meter());
const taken = held[0].measure;
taken.tag = 7;
console.log(taken === Meter.prototype.measure, (Meter.prototype.measure as any).tag, taken.name, taken.length);
