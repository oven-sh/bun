// Species: programs w method taken through unknown. It prints what plain Bun prints.
const log: string[] = [];
class Meter { size = 1; measure(by: number): string { return (this instanceof Meter ? "a meter" : "no meter") + " " + (typeof by === "number" ? "a number" : "no number"); } }
log.push(new Meter().measure(1));
const held: any[] = JSON.parse("[]");
held.push(new Meter());
const taken = held[0].measure;
log.push(taken.call({ size: "s" }, "s"));
console.log(log.join("; "));
