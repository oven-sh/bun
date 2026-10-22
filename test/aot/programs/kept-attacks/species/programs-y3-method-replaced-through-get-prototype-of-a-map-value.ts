// Species: programs  method replaced through get prototype of a map value. It prints what plain Bun prints.
const log: string[] = [];
class Meter { measure(): string { return "first"; } }
const kept = new Map<string, any>(JSON.parse("[]"));
kept.set("meter", new Meter());
for (const back of kept.values()) Object.getPrototypeOf(back).measure = function (): string { return "replaced"; };
log.push(new Meter().measure());
console.log(log.join("; "));
