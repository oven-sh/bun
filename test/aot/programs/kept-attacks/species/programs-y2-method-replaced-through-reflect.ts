// Species: programs  method replaced through reflect. It prints what plain Bun prints.
const log: string[] = [];
class Meter { measure(): string { return "first"; } }
const held: any[] = JSON.parse("[]");
held.push(new Meter());
(Reflect.getPrototypeOf(held[0]) as any).measure = function (): string { return "replaced"; };
log.push(new Meter().measure());
console.log(log.join("; "));
